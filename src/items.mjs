import { HttpError, all, choice, date, db, digest, first, id, json, normalize, now,
  pageOf, plain, requireUser, run, throttle } from './http.mjs';

const activeContactCount = `CASE WHEN i.kind = 'found' THEN
  (SELECT count(*) FROM contacts c WHERE c.item_id = i.id AND c.status IN ('pending','approved'))
  ELSE (SELECT count(*) FROM contacts c WHERE c.lost_id = i.id AND c.status IN ('pending','approved')) END`;
const linkedReservation = `i.kind = 'lost' AND EXISTS (SELECT 1 FROM items f
  WHERE f.reserved_lost_id = i.id AND f.status = 'reserved' AND f.archived_at IS NULL)`;
const authorCanChange = `i.status = 'open' AND (i.kind = 'lost' OR i.custody = 'finder')
  AND (${activeContactCount}) = 0 AND NOT (${linkedReservation})`;
const authorPublication = `CASE WHEN i.kind = 'found' AND i.publication = 'public' AND ? = 'user'
  AND (SELECT review_required FROM settings WHERE id = 1) = 1 THEN 'pending' ELSE i.publication END`;

export const itemQuery = `SELECT i.*, c.name AS category, u.name AS author_name, u.phone AS author_phone,
  r.returned_on, r.id AS return_id, r.actor_id AS return_actor_id, r.recipient_id, r.recipient_name, r.notes AS return_notes, r.lost_id,
  (SELECT group_concat(m.id) FROM (SELECT id FROM media WHERE item_id = i.id AND discard = 0 ORDER BY position) m) AS photos,
  (${activeContactCount}) AS contact_count, (${linkedReservation}) AS linked_reservation,
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

function canChangeOwnItem(item) {
  return item.status === 'open' && item.custody !== 'campus' && !item.contact_count && !item.linked_reservation;
}

export const nextUpdate = item => new Date(Math.max(Date.now(), Date.parse(item.updated_at) + 1)).toISOString();

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

export const canViewReceipt = (row,user) => Boolean(user && row.return_id &&
  (user.role === 'admin' || user.id === row.return_actor_id || user.id === row.recipient_id));

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
  const custody = search.get('custody');
  if (custody) {
    terms.push('i.custody = ?');
    params.push(choice(custody, ['campus', 'finder'], 'uma opção de guarda'));
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
    terms.push('i.author_id = ?');
    params.push(requireUser(user).id);
    if (search.get('archived') === '1') terms.push('i.archived_at IS NOT NULL', 'i.updated_by = i.author_id');
    else terms.push('i.archived_at IS NULL');
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
  return {
    items: records.results.map(row => {
      const item = itemView(row, mode !== 'public');
      if (mode !== 'public') item.canViewReceipt = mode === 'admin' ? Boolean(row.return_id) : canViewReceipt(row,user);
      if (mode === 'mine') {
        item.canChange = canChangeOwnItem(row);
        if (row.return_id && !item.canViewReceipt) Object.assign(item,{recipientId:null,recipientName:null,returnNotes:null,lostId:null});
      }
      return item;
    }),
    total: count.results[0].total, page, perPage: limit
  };
}

export async function itemDetails(env, user, itemId) {
  const item = await loadItem(env, itemId);
  if (!visible(item, user)) throw new HttpError(404, 'Item não encontrado.');
  const privileged = user && (item.author_id === user.id || item.recipient_id === user.id || user.role === 'admin');
  const data = itemView(item);
  data.isMine = item.author_id === user?.id;
  data.canManage = manages(item, user);
  data.canViewReceipt = canViewReceipt(item,user);
  data.canRate = item.return_id && user && (item.author_id === user.id || item.recipient_id === user.id);
  if (data.canRate) data.rating = item.author_id === user.id ? item.finder_rating : item.recipient_rating;
  if (privileged && item.kind === 'lost') {
    data.recoveryForId = item.recovery_for_id;
    data.recoveredItemId = item.recovered_item_id;
    data.contactCount = item.contact_count;
    data.canResolve = data.isMine && !item.archived_at && canChangeOwnItem(item);
    data.updatedAt = item.updated_at;
    data.archivedAt = item.archived_at;
  }
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
    WHERE id = ? AND updated_at = ? AND custody = 'finder' AND status <> 'returned' AND archived_at IS NULL`, user.id, nextUpdate(item), item.id, item.updated_at);
  if (!result.meta.changes) throw new HttpError(409, 'O registro mudou. Atualize a página antes de confirmar a entrega ao setor.');
  return json({});
}

export async function listMatches(env, user, lostId) {
  requireUser(user);
  const lost = await loadItem(env, lostId);
  if (!lost || lost.kind !== 'lost' || lost.archived_at || lost.status !== 'open' ||
    (lost.author_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Registro de perda não encontrado.');
  const ignore = new Set(('com dos das meu minha meus minhas uma uns umas sem para que item objeto perdido perdida ' +
    normalize(lost.category)).split(' '));
  const words = [...new Set(normalize(lost.title).split(/[^\p{L}\p{N}]+/u))].filter(word => word.length >= 3 && !ignore.has(word)).slice(0, 6);
  const place = normalize(lost.location || '');
  const items = await all(env, `WITH ranked AS (
    SELECT f.id, f.created_at, abs(julianday(f.occurred_on) - julianday(?)) AS days_apart,
      (? <> '' AND substr(f.search_text, instr(f.search_text, char(31)) + 1) = ?) AS same_place,
      (SELECT count(*) FROM json_each(?) w WHERE instr(' ' || substr(f.search_text,1,instr(f.search_text,char(31))-1), ' ' || w.value) > 0) AS common_words
    FROM items f WHERE f.kind = 'found' AND f.publication = 'public' AND f.archived_at IS NULL
      AND f.author_id <> ? AND f.category_id = ? AND (f.status = 'open' OR (f.status = 'reserved' AND f.reserved_lost_id = ?))
      AND ${lost.recovery_for_id ? 'f.id = ?' : "f.occurred_on >= date(?, '-7 days')"}
    ORDER BY common_words DESC, same_place DESC, days_apart, f.created_at DESC, f.id LIMIT 15
  ) SELECT matched.*, ranked.common_words, ranked.same_place, ranked.days_apart
    FROM ranked JOIN (${itemQuery}) matched ON matched.id = ranked.id
    ORDER BY ranked.common_words DESC, ranked.same_place DESC, ranked.days_apart, ranked.created_at DESC, ranked.id`,
    lost.occurred_on, place, place, JSON.stringify(words), lost.author_id, lost.category_id, lost.id, lost.recovery_for_id || lost.occurred_on);
  return json({ items: items.map(row => ({ ...itemView(row), reasons: [
    ...(row.common_words ? ['Palavras em comum'] : []), ...(row.same_place ? ['Mesmo local'] : []),
    ...(row.days_apart <= 3 ? ['Datas próximas'] : [])
  ] })) });
}

export async function claimOptions(env, user, foundId) {
  requireUser(user);
  const found = await loadItem(env, foundId);
  if (!found || found.kind !== 'found' || found.publication !== 'public' || found.archived_at) throw new HttpError(404, 'Objeto não encontrado.');
  const losses = await all(env, `SELECT id, title, occurred_on AS occurredOn FROM items
    WHERE author_id = ? AND kind = 'lost' AND status = 'open' AND archived_at IS NULL
      AND category_id = ? AND (recovery_for_id IS NULL OR recovery_for_id = ?)
    ORDER BY (recovery_for_id IS NOT NULL) DESC, occurred_on DESC, created_at DESC, id`, user.id, found.category_id, found.id);
  return json({ losses });
}

export async function resolveOwnLoss(env, user, itemId, input) {
  requireUser(user);
  const item = await loadItem(env, itemId);
  if (!item || item.kind !== 'lost' || item.author_id !== user.id || item.archived_at) throw new HttpError(404, 'Perda não encontrada.');
  if (item.status === 'recovered' && !item.recovered_item_id) return json({ status: 'recovered' });
  if (input.updatedAt !== item.updated_at) throw new HttpError(409, 'O registro mudou. Atualize a página antes de encerrar a perda.');
  const result = await run(env, `UPDATE items AS i SET status = 'recovered', updated_by = ?, updated_at = ?
    WHERE i.id = ? AND i.kind = 'lost' AND i.author_id = ? AND i.archived_at IS NULL AND i.updated_at = ?
    AND ${authorCanChange}`, user.id, nextUpdate(item), item.id, user.id, item.updated_at);
  if (!result.meta.changes) {
    const current = await loadItem(env, item.id);
    if (current?.status === 'recovered' && !current.recovered_item_id && !current.archived_at) return json({ status: 'recovered' });
    throw new HttpError(409, 'A perda mudou ou tem uma solicitação ou reserva em andamento.');
  }
  return json({ status: 'recovered' });
}

async function ownItemForChange(env, user, itemId, updatedAt, archived = false) {
  requireUser(user);
  const item = await loadItem(env, itemId);
  if (!item || item.author_id !== user.id || Boolean(item.archived_at) !== archived || (archived && item.updated_by !== user.id)) {
    throw new HttpError(404, 'Registro não encontrado.');
  }
  if (updatedAt !== item.updated_at) throw new HttpError(409, 'O registro mudou. Atualize a página e tente novamente.');
  if (!canChangeOwnItem(item)) throw new HttpError(409, 'O registro está sob guarda do setor, encerrado ou vinculado a um pedido ativo.');
  return item;
}

export async function editItem(env, user, itemId, input, { own = false } = {}) {
  const item = own ? await ownItemForChange(env, user, itemId, input.updatedAt) : await loadItem(env, itemId);
  if (!item || item.archived_at) throw new HttpError(404, 'Item não encontrado.');
  if (!own && input.updatedAt !== undefined && input.updatedAt !== item.updated_at) {
    throw new HttpError(409, 'O registro mudou. Atualize a página e tente novamente.');
  }
  const fields = await prepareItem(env, { ...input, custody: item.custody }, item.kind, item);
  if (item.status === 'returned' && fields.occurred > item.returned_on) throw new HttpError(400, 'A data do encontro precisa ser anterior à devolução.');
  if ((item.reserved_lost_id || item.recovery_for_id || item.contact_count || item.linked_reservation || item.return_id || item.status === 'recovered') &&
      fields.category.id !== item.category_id) throw new HttpError(409, 'A categoria está vinculada a uma solicitação ou devolução.');
  if (fields.title === item.title && fields.description === item.description && fields.category.id === item.category_id &&
      fields.location === item.location && fields.occurred === item.occurred_on && fields.sharePhone === item.share_phone) {
    return json({ publication: item.publication });
  }
  if (item.recovery_for_id) fields.fingerprint = item.fingerprint;
  try {
    const changed = await first(env, `UPDATE items AS i SET title = ?, description = ?, category_id = ?, location = ?,
      occurred_on = ?, custody = ?, share_phone = ?, search_text = ?, fingerprint = ?, updated_by = ?, updated_at = ?,
      publication = ${own ? authorPublication : 'i.publication'}
      WHERE i.id = ? AND i.archived_at IS NULL AND i.updated_at = ? AND (i.category_id = ? OR (NOT (${linkedReservation}) AND NOT EXISTS (
        SELECT 1 FROM contacts c WHERE (c.item_id = i.id OR c.lost_id = i.id) AND c.status IN ('pending','approved','delivered')
      ))) ${own ? `AND i.author_id = ? AND ${authorCanChange}` : ''} RETURNING publication`,
      ...itemValues(fields), user.id, nextUpdate(item), ...(own ? [user.role] : []),
      item.id, item.updated_at, fields.category.id, ...(own ? [user.id] : []));
    if (!changed) throw new HttpError(409, 'O registro mudou. Atualize a página e tente novamente.');
    return json(changed);
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe um registro idêntico.');
    throw error;
  }
}

export async function archiveOwnItem(env, user, itemId, input) {
  requireUser(user);
  const action = choice(input.action, ['archive', 'restore'], 'uma ação válida');
  const restoring = action === 'restore';
  const item = await ownItemForChange(env, user, itemId, input.updatedAt, restoring);
  const time = nextUpdate(item);
  try {
    const changed = await first(env, `UPDATE items AS i SET archived_at = ?, updated_by = ?, updated_at = ?,
      publication = ${restoring ? authorPublication : 'i.publication'}
      WHERE i.id = ? AND i.author_id = ? AND i.updated_at = ? AND ${authorCanChange}
      AND ${restoring ? 'i.archived_at IS NOT NULL AND i.updated_by = i.author_id' : 'i.archived_at IS NULL'} RETURNING publication`,
      restoring ? null : time, user.id, time, ...(restoring ? [user.role] : []), item.id, user.id, item.updated_at);
    if (!changed) throw new HttpError(409, 'O registro mudou. Atualize a página e tente novamente.');
    return json(changed);
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe um registro ativo com essas informações.');
    throw error;
  }
}
