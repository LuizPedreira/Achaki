import { HttpError, all, choice, date, db, digest, first, id, json, normalize, now,
  pageOf, plain, requireUser, run, stamp, throttle } from './http.mjs';

export const itemQuery = `SELECT i.*, c.name AS category, u.name AS author_name, u.phone AS author_phone,
  r.returned_on, r.id AS return_id, r.recipient_id, r.recipient_name, r.notes AS return_notes, r.lost_id,
  (SELECT group_concat(m.id) FROM (SELECT id FROM media WHERE item_id = i.id AND discard = 0 ORDER BY position) m) AS photos,
  (SELECT count(*) FROM contacts x WHERE x.item_id = i.id AND x.status IN ('pending','approved')) AS contact_count,
  (SELECT score FROM ratings WHERE item_id = i.id AND perspective = 'finder') AS finder_rating,
  (SELECT score FROM ratings WHERE item_id = i.id AND perspective = 'recipient') AS recipient_rating,
  (SELECT item_id FROM returns WHERE lost_id = i.id) AS recovered_item_id
  FROM items i JOIN categories c ON c.id = i.category_id JOIN users u ON u.id = i.author_id
  LEFT JOIN returns r ON r.item_id = i.id`;

export function itemView(row, detailed = false) {
  const item = {
    id: row.id, kind: row.kind, title: row.title, description: row.description,
    categoryId: row.category_id, category: row.category, location: row.location,
    occurredOn: row.occurred_on, status: row.status, custody: row.custody, publication: row.publication,
    photos: row.photos ? row.photos.split(',').map(id => `/api/media/${id}`) : [],
    createdAt: row.created_at, returnedOn: row.returned_on
  };
  if (!detailed) return item;
  return {
    ...item, authorId: row.author_id, authorName: row.author_name, archivedAt: row.archived_at,
    sharePhone: Boolean(row.share_phone), contactPhone: row.kind === 'lost' && row.share_phone ? row.author_phone : null,
    reservationName: row.reservation_name, reservedContactId: row.reserved_contact_id,
    reservedLostId: row.reserved_lost_id, recoveryForId: row.recovery_for_id, recipientId: row.recipient_id,
    recipientName: row.recipient_name, returnNotes: row.return_notes, lostId: row.lost_id,
    finderRating: row.finder_rating, recipientRating: row.recipient_rating, contactCount: row.contact_count,
    updatedAt: row.updated_at, recoveredItemId: row.recovered_item_id
  };
}

export async function metadata(env) {
  const [categories, locations, settings] = await env.DB.batch([
    db(env, 'SELECT id,name FROM categories WHERE active = 1 ORDER BY rowid'),
    db(env, 'SELECT id,name FROM locations WHERE active = 1 ORDER BY rowid'),
    db(env, 'SELECT sector_location AS location, sector_hours AS hours FROM settings WHERE id = 1')
  ]);
  return { categories: categories.results, locations: locations.results, sector: settings.results[0] };
}

export async function loadItem(env, itemId) {
  return first(env, `${itemQuery} WHERE i.id = ?`, id(itemId));
}

export const manages = (item, user) => Boolean(user && (item.custody === 'campus' ? user.role === 'admin' : item.author_id === user.id));

export function visible(item, user) {
  return Boolean(item && (
    user?.role === 'admin' ||
    (item.return_id && (item.author_id === user?.id || item.recipient_id === user?.id)) ||
    (!item.archived_at && (item.author_id === user?.id || (item.kind === 'found' && item.publication === 'public')))
  ));
}

function filterClauses(search) {
  const terms = [];
  const params = [];
  const keyword = normalize(plain(search.get('q'), 'a busca', 0, 120));
  for (const word of keyword.split(' ').filter(Boolean).slice(0, 10)) {
    terms.push('instr(i.search_text, ?) > 0');
    params.push(word);
  }
  const location = normalize(plain(search.get('location'), 'o local', 0, 120));
  if (location) {
    terms.push("instr(substr(i.search_text, instr(i.search_text, char(31)) + 1), ?) > 0");
    params.push(location);
  }
  const category = plain(search.get('category'), 'a categoria', 0, 90);
  if (category) {
    terms.push('i.category_id = ?');
    params.push(category);
  }
  const status = search.get('status');
  if (status) {
    terms.push('i.status = ?');
    params.push(choice(status, ['open', 'reserved', 'returned', 'recovered'], 'um status válido'));
  }
  const start = date(search.get('from'), true);
  const end = date(search.get('to'), true);
  if (start && end && start > end) throw new HttpError(400, 'A data inicial precisa vir antes da data final.');
  if (start) { terms.push('i.occurred_on >= ?'); params.push(start); }
  if (end) { terms.push('i.occurred_on <= ?'); params.push(end); }
  return { terms, params };
}

export async function listItems(env, search, { mode = 'public', user = null } = {}) {
  const { terms, params } = filterClauses(search);
  if (mode === 'public') terms.push("i.kind = 'found'", "i.publication = 'public'", 'i.archived_at IS NULL');
  if (mode === 'mine') {
    terms.push('i.author_id = ?', 'i.archived_at IS NULL');
    params.push(requireUser(user).id);
  }
  if (mode !== 'public') {
    const kind = search.get('kind');
    if (kind) { terms.push('i.kind = ?'); params.push(choice(kind, ['found','lost'], 'um tipo de registro')); }
  }
  if (mode === 'admin') {
    if (search.get('archived') === '1') terms.push('i.archived_at IS NOT NULL');
    else terms.push('i.archived_at IS NULL');
    if (search.get('review') === '1') terms.push("i.publication = 'pending'");
    if (search.get('history') === 'pending') terms.push("i.status IN ('open','reserved')");
    if (search.get('history') === 'complete') terms.push("i.status IN ('returned','recovered')");
  }
  const { page, offset, limit } = pageOf(search);
  const where = terms.length ? ` WHERE ${terms.join(' AND ')}` : '';
  const order = mode === 'admin' && search.get('history') === 'complete' ? 'COALESCE(r.returned_on,i.updated_at) DESC' : 'i.occurred_on DESC, i.created_at DESC';
  const [records, count] = await env.DB.batch([
    db(env, `${itemQuery}${where} ORDER BY ${order}, i.id LIMIT ? OFFSET ?`, ...params, limit, offset),
    db(env, `SELECT count(*) AS total FROM items i${where}`, ...params)
  ]);
  return { items: records.results.map(item => itemView(item, mode !== 'public')), total: count.results[0].total, page, perPage: limit };
}

export async function itemDetails(env, user, itemId) {
  const item = await loadItem(env, itemId);
  if (!visible(item, user)) throw new HttpError(404, 'Item não encontrado.');
  const privileged = user && (item.author_id === user.id || item.recipient_id === user.id || user.role === 'admin');
  const data = itemView(item);
  data.isMine = item.author_id === user?.id;
  data.canManage = manages(item, user);
  data.canRate = item.return_id && user && (item.author_id === user.id || item.recipient_id === user.id);
  if (data.canRate) data.rating = item.author_id === user.id ? item.finder_rating : item.recipient_rating;
  if (privileged && item.kind === 'lost') data.recoveryForId = item.recovery_for_id;
  if (privileged && item.return_id) data.returnSummary = { returnedOn: item.returned_on, custody: item.custody };
  if (user && item.kind === 'found' && item.author_id !== user.id) {
    data.request = await first(env, 'SELECT id,status,lost_id AS lostId FROM contacts WHERE item_id = ? AND requester_id = ? ORDER BY created_at DESC LIMIT 1', item.id, user.id);
  }
  return json({ item: data });
}

export async function prepareItem(env, input, kind, original = null) {
  const title = plain(input.title, 'o título', 3, 90);
  const description = plain(input.description, 'a descrição', 8, 1200);
  const category = await first(env, 'SELECT id,name FROM categories WHERE id = ? AND (active = 1 OR id = ?)',
    plain(input.categoryId, 'a categoria', 1, 90), original?.category_id || '');
  if (!category) throw new HttpError(400, 'Selecione uma categoria disponível.');
  const location = plain(input.location, 'o local', kind === 'found' ? 2 : 0, 120);
  const occurred = date(input.occurredOn);
  const custody = kind === 'found' ? choice(input.custody, ['finder','campus'], 'quem está com o item') : null;
  const searchText = `${normalize([title, description, category.name].join(' '))}\x1f${normalize(location)}`;
  const fingerprint = await digest([category.id, occurred, normalize(title), normalize(description), normalize(location)].join('\x1f'));
  return { title, description, category, location, occurred, custody, searchText, fingerprint, sharePhone: input.sharePhone === true ? 1 : 0 };
}

export function itemValues(item) {
  return [item.title, item.description, item.category.id, item.location, item.occurred, item.custody, item.sharePhone, item.searchText, item.fingerprint];
}

export async function createItem(env, user, input) {
  requireUser(user);
  await throttle(env, `item-create:${user.id}`, 18, 3600);
  if (!user.phone) throw new HttpError(409, 'Informe seu telefone no perfil antes de registrar um objeto.');
  const kind = choice(input.kind, ['found','lost'], 'o tipo de registro');
  const fields = await prepareItem(env, input, kind);
  const photos = Array.isArray(input.photos) ? input.photos.map(id) : [];
  if (new Set(photos).size !== photos.length || photos.length > 3 || (kind === 'found' && !photos.length)) {
    throw new HttpError(400, 'Itens encontrados precisam de uma a três fotos. Para itens perdidos, as fotos são opcionais.');
  }
  const itemId = crypto.randomUUID();
  const statement = db(env, `INSERT INTO items
    (id,kind,author_id,title,description,category_id,location,occurred_on,custody,share_phone,search_text,fingerprint,publication,updated_by)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?, CASE WHEN ? = 'lost' THEN 'private'
      WHEN review_required = 1 AND ? = 'user' THEN 'pending' ELSE 'public' END, ?
    FROM settings WHERE id = 1
    AND (SELECT count(*) FROM media WHERE owner_id = ? AND item_id IS NULL AND discard = 0
      AND created_at > ? AND id IN (SELECT value FROM json_each(?))) = ?`,
    itemId, kind, user.id, ...itemValues(fields), kind, user.role, user.id, user.id, now() - 86400, JSON.stringify(photos), photos.length);
  const attachments = photos.map((photoId, index) => db(env, `UPDATE media SET item_id = ?, position = ?
    WHERE id = ? AND owner_id = ? AND item_id IS NULL AND discard = 0 AND EXISTS (SELECT 1 FROM items WHERE id = ?)`,
    itemId, index + 1, photoId, user.id, itemId));
  try {
    const result = await env.DB.batch([statement, ...attachments]);
    if (!result[0].meta.changes) throw new HttpError(409, 'Uma das fotos expirou ou já foi usada. Envie as fotos novamente.');
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe um registro idêntico.');
    throw error;
  }
  return json({ item: itemView(await loadItem(env, itemId), true) }, 201);
}

export async function transferToCampus(env, user, itemId) {
  requireUser(user);
  const item = await loadItem(env, itemId);
  if (!item || item.kind !== 'found' || item.author_id !== user.id || item.archived_at) throw new HttpError(404, 'Item não encontrado.');
  const result = await run(env, `UPDATE items SET custody = 'campus', updated_by = ?, updated_at = ?
    WHERE id = ? AND custody = 'finder' AND status <> 'returned' AND archived_at IS NULL`, user.id, stamp(), item.id);
  if (!result.meta.changes) throw new HttpError(409, 'Este item já foi devolvido ou entregue ao setor.');
  return json({});
}

export async function listMatches(env, user, lostId) {
  requireUser(user);
  const lost = await loadItem(env, lostId);
  if (!lost || lost.kind !== 'lost' || lost.archived_at || lost.status !== 'open' ||
    (lost.author_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Registro de perda não encontrado.');
  const items = await all(env, `${itemQuery} WHERE i.kind = 'found' AND i.publication = 'public' AND i.status IN ('open','reserved')
    AND i.archived_at IS NULL AND i.author_id <> ? AND i.category_id = ?
    AND ((? IS NOT NULL AND i.id = ?) OR (? IS NULL AND i.occurred_on >= date(?, '-7 days')))
    ORDER BY abs(julianday(i.occurred_on) - julianday(?)), i.created_at DESC LIMIT 15`,
    lost.author_id, lost.category_id, lost.recovery_for_id, lost.recovery_for_id, lost.recovery_for_id, lost.occurred_on, lost.occurred_on);
  return json({ items: items.map(item => itemView(item)) });
}

export async function editItem(env, user, itemId, input) {
  const item = await loadItem(env, itemId);
  if (!item || item.archived_at) throw new HttpError(404, 'Item não encontrado.');
  const fields = await prepareItem(env, { ...input, custody: item.custody }, item.kind, item);
  if (item.status === 'returned' && fields.occurred > item.returned_on) throw new HttpError(400, 'A data do encontro precisa ser anterior à devolução.');
  if ((item.reserved_lost_id || item.recovery_for_id || item.contact_count || item.return_id || item.status === 'recovered') &&
      fields.category.id !== item.category_id) throw new HttpError(409, 'A categoria está vinculada a uma solicitação ou devolução.');
  try {
    const changed = await run(env, `UPDATE items SET title = ?, description = ?, category_id = ?, location = ?,
      occurred_on = ?, custody = ?, share_phone = ?, search_text = ?, fingerprint = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND archived_at IS NULL AND updated_at = ? AND (category_id = ? OR NOT EXISTS (
        SELECT 1 FROM contacts c WHERE (c.item_id = items.id OR c.lost_id = items.id) AND c.status IN ('pending','approved','delivered')
      ))`, ...itemValues(fields), user.id, stamp(), item.id, item.updated_at, fields.category.id);
    if (!changed.meta.changes) throw new HttpError(409, 'O registro mudou. Atualize a página e tente novamente.');
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe um registro idêntico.');
    throw error;
  }
  return json({});
}
