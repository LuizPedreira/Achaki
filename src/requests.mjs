import { HttpError, all, choice, date, db, digest, first, id, json, pageOf, plain,
  requireUser, run, stamp, throttle } from './http.mjs';
import { loadItem, manages } from './items.mjs';

export async function requestContact(env, user, itemId, input) {
  requireUser(user);
  if (!user.phone) throw new HttpError(409, 'Informe seu telefone no perfil antes de solicitar contato.');
  await throttle(env, `contact:${user.id}`, 20, 3600);
  const item = await loadItem(env, itemId);
  if (!item || item.kind !== 'found' || item.publication !== 'public' || item.archived_at) throw new HttpError(404, 'Item não encontrado.');
  if (item.author_id === user.id || !['open','reserved'].includes(item.status)) throw new HttpError(409, 'Este item não recebe novas solicitações.');
  const existing = await first(env, "SELECT id,lost_id AS lostId,status FROM contacts WHERE item_id = ? AND requester_id = ? AND status IN ('pending','approved')", item.id, user.id);
  if (existing) return json({ contact: existing });
  const message = plain(input.message, 'o detalhe que comprova que o item é seu', 10, 700);
  let lostId = input.lostId ? id(input.lostId) : null;
  if (!lostId) {
    const prior = await first(env, `SELECT id FROM items WHERE kind = 'lost' AND author_id = ? AND recovery_for_id = ?
      AND status = 'open' AND archived_at IS NULL LIMIT 1`, user.id, item.id);
    lostId = prior?.id || null;
  }
  const contactId = crypto.randomUUID();
  const changes = [];
  if (!lostId) {
    lostId = crypto.randomUUID();
    changes.push(db(env, `INSERT INTO items(id,kind,author_id,title,description,category_id,location,occurred_on,
        publication,search_text,fingerprint,recovery_for_id,updated_by)
      SELECT ?,'lost',?,title,?,category_id,location,occurred_on,'private',search_text,?,id,? FROM items
      WHERE id = ? AND publication = 'public' AND status IN ('open','reserved') AND archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM contacts WHERE item_id = items.id AND requester_id = ? AND status IN ('pending','approved'))`,
      lostId, user.id, 'Solicitação de recuperação criada ao pedir contato.', await digest(`recovery:${item.id}`), user.id, item.id, user.id));
  }
  changes.push(db(env, `INSERT INTO contacts(id,item_id,requester_id,lost_id,message)
    SELECT ?,f.id,?,l.id,? FROM items f JOIN items l ON l.id = ?
    WHERE f.id = ? AND f.kind = 'found' AND f.status IN ('open','reserved') AND f.publication = 'public'
      AND f.archived_at IS NULL AND f.author_id <> ? AND l.author_id = ? AND l.kind = 'lost' AND l.status = 'open'
      AND l.archived_at IS NULL AND l.category_id = f.category_id AND (l.recovery_for_id IS NULL OR l.recovery_for_id = f.id)`,
    contactId, user.id, message, lostId, item.id, user.id, user.id));
  try {
    const results = await env.DB.batch(changes);
    if (results.at(-1).meta.changes) return json({ contact: { id: contactId, status: 'pending', lostId } }, 201);
  } catch (error) {
    if (!/unique/i.test(error.message)) throw error;
  }
  const winner = await first(env, "SELECT id,lost_id AS lostId,status FROM contacts WHERE item_id = ? AND requester_id = ? AND status IN ('pending','approved')", item.id, user.id);
  if (winner) return json({ contact: winner });
  throw new HttpError(409, 'O item ou o registro de perda selecionado não está mais disponível.');
}

export async function inbox(env, user, search) {
  requireUser(user);
  const staff = search.get('scope') === 'campus' && user.role === 'admin';
  const filter = staff ? "i.custody = 'campus'" : "(c.requester_id = ? OR (i.custody = 'finder' AND i.author_id = ?))";
  const args = staff ? [] : [user.id,user.id];
  const { page,offset,limit } = pageOf(search);
  const [records,count] = await env.DB.batch([
    db(env, `SELECT c.*, i.title, i.custody, i.author_id, i.reserved_contact_id, i.reserved_lost_id, i.status AS item_status,
    i.archived_at, requester.name AS requester_name, requester.phone AS requester_phone,
    author.phone AS author_phone, s.sector_phone, s.sector_location, s.sector_hours
    FROM contacts c JOIN items i ON i.id = c.item_id JOIN users requester ON requester.id = c.requester_id
    JOIN users author ON author.id = i.author_id CROSS JOIN settings s WHERE s.id = 1 AND ${filter}
    ORDER BY CASE c.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, c.updated_at DESC,c.id LIMIT ? OFFSET ?`, ...args,limit,offset),
    db(env, `SELECT count(*) AS total FROM contacts c JOIN items i ON i.id = c.item_id WHERE ${filter}`,...args)
  ]);
  return json({ total:count.results[0].total,page,perPage:limit,contacts:records.results.map(row => {
    const side = row.requester_id === user.id ? 'sent' : 'received';
    const live = ['open','reserved'].includes(row.item_status) && !row.archived_at;
    const approved = live && row.status === 'approved';
    const available = (!row.reserved_contact_id || row.reserved_contact_id === row.id) && (!row.reserved_lost_id || row.reserved_lost_id === row.lost_id);
    return {
      id: row.id, itemId: row.item_id, title: row.title, status: row.status, side, custody: row.custody,
      requesterName: side === 'received' ? row.requester_name : null,
      message: row.message, createdAt: row.created_at, canReview: side === 'received' && live && row.status === 'pending',
      canDeliver: side === 'received' && live && available && ['pending','approved'].includes(row.status),
      canApprove: side === 'received' && live && available && row.status === 'pending',
      canRevoke: side === 'received' && approved && available,
      phone: approved ? (side === 'received' ? row.requester_phone : row.custody === 'campus' ? row.sector_phone : row.author_phone) : null,
      sector: approved && row.custody === 'campus' ? { location: row.sector_location, hours: row.sector_hours } : null
    };
  }) });
}

export async function reviewContact(env, user, contactId, input) {
  requireUser(user);
  const contact = await first(env, 'SELECT * FROM contacts WHERE id = ?', id(contactId));
  if (!contact) throw new HttpError(404, 'Solicitação não encontrada.');
  const item = await loadItem(env, contact.item_id);
  if (!item || item.archived_at || item.status === 'returned') throw new HttpError(409, 'O item já foi encerrado.');
  const action = choice(input.action, ['approve','reject','cancel'], 'uma ação');
  if (action === 'cancel' ? contact.requester_id !== user.id : !manages(item,user)) throw new HttpError(403, 'Você não tem acesso a esta solicitação.');
  const time = stamp();
  const version = item.updated_at;
  const reviewer = "EXISTS (SELECT 1 FROM users a WHERE a.id = ? AND a.active = 1 AND ((i.custody = 'campus' AND a.role = 'admin') OR (i.custody = 'finder' AND i.author_id = a.id)))";
  const lostAvailable = "EXISTS (SELECT 1 FROM items l WHERE l.id = contacts.lost_id AND l.kind = 'lost' AND l.status = 'open' AND l.archived_at IS NULL)";
  if (action === 'approve') {
    try {
      const results = await env.DB.batch([
        db(env, `UPDATE contacts SET status = 'approved', updated_at = ?
          WHERE id = ? AND status = 'pending' AND ${lostAvailable} AND EXISTS (
            SELECT 1 FROM items i WHERE i.id = contacts.item_id AND i.updated_at = ? AND i.archived_at IS NULL AND ${reviewer}
              AND i.status IN ('open','reserved') AND (i.reserved_contact_id IS NULL OR i.reserved_contact_id = contacts.id)
              AND (i.reserved_lost_id IS NULL OR i.reserved_lost_id = contacts.lost_id)
          )`, time, contact.id, version, user.id),
        db(env, `UPDATE items SET status = 'reserved', reservation_name = (SELECT name FROM users WHERE id = ?),
          reserved_contact_id = ?, reserved_lost_id = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM contacts WHERE id = ? AND status = 'approved' AND updated_at = ?)`,
          contact.requester_id, contact.id, contact.lost_id, user.id, time, item.id, contact.id, time)
      ]);
      if (!results[0].meta.changes) throw new HttpError(409, 'A reserva ou a solicitação mudou. Atualize a página.');
    } catch (error) {
      if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe outra identificação aprovada para este item.');
      throw error;
    }
  } else {
    const next = action === 'cancel' ? 'cancelled' : 'rejected';
    const results = await env.DB.batch([
      db(env, `UPDATE contacts SET status = ?, updated_at = ? WHERE id = ? AND status IN ('pending','approved')
        AND EXISTS (SELECT 1 FROM items i WHERE i.id = contacts.item_id AND i.updated_at = ? AND i.archived_at IS NULL
          AND ${action === 'cancel' ? 'contacts.requester_id = ?' : reviewer})`, next, time, contact.id, version, user.id),
      db(env, `UPDATE items SET status = 'open', reservation_name = NULL, reserved_contact_id = NULL,
        reserved_lost_id = NULL, updated_by = ?, updated_at = ?
        WHERE id = ? AND reserved_contact_id = ? AND EXISTS (SELECT 1 FROM contacts WHERE id = ? AND status = ? AND updated_at = ?)`,
        user.id, time, item.id, contact.id, contact.id, next, time)
    ]);
    if (!results[0].meta.changes) throw new HttpError(409, 'A solicitação já foi atualizada.');
  }
  return json({});
}

export async function returnItem(env, user, itemId, input) {
  requireUser(user);
  const item = await loadItem(env, itemId);
  if (!item || item.kind !== 'found' || item.archived_at) throw new HttpError(404, 'Item não encontrado.');
  if (!manages(item, user)) throw new HttpError(403, 'A devolução precisa ser registrada por quem está com o objeto.');
  if (item.status === 'returned') return json({ returnId: item.return_id });
  const inputContact = input.contactId ? id(input.contactId) : null;
  const inputLost = input.lostId ? id(input.lostId) : null;
  const contactId = inputContact || item.reserved_contact_id;
  let lostId = inputLost || item.reserved_lost_id;
  let recipientId = null;
  let recipientName;
  if (contactId) {
    const contact = await first(env, `SELECT c.*, u.name FROM contacts c JOIN users u ON u.id = c.requester_id
      WHERE c.id = ? AND c.item_id = ? AND c.status IN ('pending','approved')`, contactId, item.id);
    if (!contact || (lostId && lostId !== contact.lost_id)) throw new HttpError(409, 'A solicitação selecionada já foi encerrada ou mudou.');
    lostId = contact.lost_id;
    recipientId = contact.requester_id;
    recipientName = contact.name;
  } else if (lostId) {
    const lost = await loadItem(env, lostId);
    if (!lost || lost.kind !== 'lost' || lost.status !== 'open' || lost.archived_at ||
        (user.role !== 'admin' && item.reserved_lost_id !== lost.id)) {
      throw new HttpError(409, 'Vincule a perda por meio de uma solicitação de contato ou pelo painel do setor.');
    }
    recipientId = lost.author_id;
    recipientName = lost.author_name;
  } else {
    recipientName = plain(input.recipientName || item.reservation_name, 'o nome de quem recebeu', 2, 90);
  }
  if (recipientId === user.id || recipientId === item.author_id) throw new HttpError(400, 'O responsável pela entrega não pode ser o beneficiário vinculado à devolução.');
  const returnedOn = date(input.returnedOn);
  if (returnedOn < item.occurred_on) throw new HttpError(400, 'A data da devolução precisa ser igual ou posterior à data do encontro.');
  const notes = plain(input.notes,'as observações',0,700);
  const returnId = crypto.randomUUID();
  try {
    await run(env, `INSERT INTO returns(id,item_id,actor_id,recipient_id,recipient_name,lost_id,contact_id,returned_on,notes,custody)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, returnId, item.id, user.id, recipientId, recipientName, lostId, contactId, returnedOn, notes, item.custody);
  } catch (error) {
    if (/return_item_unavailable|unique/i.test(error.message)) {
      const recorded = await first(env, 'SELECT id FROM returns WHERE item_id = ?', item.id);
      if (recorded) return json({ returnId: recorded.id });
    }
    if (/return_.*unavailable|unique/i.test(error.message)) throw new HttpError(409, 'O item, a reserva ou a solicitação mudou. Atualize a página.');
    throw error;
  }
  return json({ returnId }, 201);
}

export async function rating(env, user, itemId, input) {
  requireUser(user);
  const item = await loadItem(env, itemId);
  if (!item || !item.return_id) throw new HttpError(404, 'Devolução não encontrada.');
  const perspective = item.author_id === user.id ? 'finder' : item.recipient_id === user.id ? 'recipient' : null;
  if (!perspective) throw new HttpError(403, 'A avaliação está disponível aos participantes da devolução.');
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new HttpError(400, 'Selecione uma nota de 1 a 5.');
  const comment = plain(input.comment, 'o comentário', 0, 700);
  try {
    await run(env, 'INSERT INTO ratings(item_id,user_id,perspective,score,comment) VALUES (?,?,?,?,?)', item.id, user.id, perspective, input.score, comment);
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Você já avaliou esta devolução.');
    if (/rating_not_allowed/i.test(error.message)) throw new HttpError(403, 'Esta devolução não está disponível para avaliação.');
    throw error;
  }
  return json({}, 201);
}

export async function myRatings(env, user) {
  requireUser(user);
  const items = await all(env, `SELECT i.id, i.title, r.score, r.comment, r.perspective, r.created_at AS createdAt FROM ratings r
    JOIN items i ON i.id = r.item_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 80`, user.id);
  return json({ items });
}

export async function myReturns(env, user) {
  requireUser(user);
  const items = await all(env, `SELECT i.id,i.title,r.returned_on AS returnedOn,
    (SELECT score FROM ratings WHERE item_id = i.id AND user_id = ?) AS rating
    FROM returns r JOIN items i ON i.id = r.item_id
    WHERE (r.recipient_id = ? OR i.author_id = ?) ORDER BY (rating IS NOT NULL), r.returned_on DESC LIMIT 80`,
    user.id,user.id,user.id);
  return json({ items });
}

export async function adminDetails(env, itemId) {
  const item = await loadItem(env, itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  const [timeline, ratings] = await env.DB.batch([
    db(env, `SELECT a.action,a.details,a.created_at AS createdAt,u.name AS actor FROM audit a
      JOIN users u ON u.id = a.actor_id WHERE a.item_id = ? ORDER BY a.id DESC LIMIT 50`, item.id),
    db(env, `SELECT r.score,r.comment,r.perspective,r.created_at AS createdAt,u.name FROM ratings r
      JOIN users u ON u.id = r.user_id WHERE r.item_id = ? ORDER BY r.created_at`, item.id)
  ]);
  return json({ timeline: timeline.results, ratings: ratings.results });
}
