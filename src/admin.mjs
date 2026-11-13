import { HttpError, all, date, db, first, id, json, normalize, phone, plain, run, stamp } from './http.mjs';
import { loadItem } from './items.mjs';

export async function dashboard(env) {
  const [counts, recent, categories] = await env.DB.batch([
    db(env, `SELECT
      (SELECT count(*) FROM items WHERE kind = 'found' AND status IN ('open','reserved') AND archived_at IS NULL) AS found,
      (SELECT count(*) FROM items WHERE kind = 'lost' AND status = 'open' AND archived_at IS NULL) AS lost,
      (SELECT count(*) FROM returns WHERE returned_on >= date('now','-30 days')) AS returned,
      (SELECT count(*) FROM contacts c JOIN items i ON i.id = c.item_id WHERE c.status = 'pending' AND i.custody = 'campus') AS contacts,
      (SELECT count(*) FROM items WHERE publication = 'pending' AND archived_at IS NULL) AS review,
      (SELECT round(avg(score),1) FROM ratings) AS rating`),
    db(env, `SELECT i.id,i.kind,i.title,i.status,i.created_at AS createdAt,c.name AS category
      FROM items i JOIN categories c ON c.id = i.category_id WHERE i.archived_at IS NULL
      ORDER BY i.created_at DESC LIMIT 8`),
    db(env, `SELECT c.name, count(i.id) AS total FROM categories c LEFT JOIN items i
      ON i.category_id = c.id AND i.archived_at IS NULL AND i.kind = 'found' AND i.status IN ('open','reserved')
      GROUP BY c.id ORDER BY total DESC, c.name LIMIT 8`)
  ]);
  return json({ counts: counts.results[0], recent: recent.results, categories: categories.results });
}

export async function manageItem(env, user, itemId, input) {
  const item = await loadItem(env, itemId);
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  const time = stamp();
  const version = [item.id, item.updated_at];
  let statements;
  switch (input.action) {
    case 'approve':
    case 'hide': {
      if (item.kind !== 'found' || item.archived_at) throw new HttpError(409, 'Este item não pode ser publicado.');
      statements = [db(env, `UPDATE items SET publication = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND updated_at = ? AND archived_at IS NULL`, input.action === 'approve' ? 'public' : 'hidden', user.id, time, ...version)];
      break;
    }
    case 'archive': {
      if (item.archived_at) return json({});
      const attached = "EXISTS(SELECT 1 FROM items WHERE id = ? AND archived_at = ?)";
      statements = [
        db(env, `UPDATE items SET archived_at = ?, updated_by = ?, updated_at = ?, status = CASE WHEN status = 'reserved' THEN 'open' ELSE status END,
          reservation_name = NULL, reserved_contact_id = NULL, reserved_lost_id = NULL WHERE id = ? AND updated_at = ? AND archived_at IS NULL`, time, user.id, time, ...version),
        db(env, `UPDATE contacts SET status = 'cancelled', updated_at = ? WHERE (item_id = ? OR lost_id = ?) AND status IN ('pending','approved')
          AND ${attached}`, time, item.id, item.id, item.id, time),
        db(env, `UPDATE items SET status = 'open', reservation_name = NULL, reserved_contact_id = NULL, reserved_lost_id = NULL,
          updated_by = ?, updated_at = ? WHERE status = 'reserved' AND reserved_lost_id = ? AND ${attached}`, user.id, time, item.id, item.id, time)
      ];
      break;
    }
    case 'restore': {
      if (!item.archived_at) return json({});
      statements = [db(env, 'UPDATE items SET archived_at = NULL, updated_by = ?, updated_at = ? WHERE id = ? AND updated_at = ?', user.id, time, ...version)];
      break;
    }
    case 'reserve': {
      if (item.archived_at || item.kind !== 'found' || item.status !== 'open') throw new HttpError(409, 'Somente itens encontrados em aberto podem ser reservados.');
      const lostId = input.lostId ? id(input.lostId) : null;
      let name;
      if (lostId) {
        const lost = await loadItem(env, lostId);
        if (!lost || lost.kind !== 'lost' || lost.archived_at || lost.status !== 'open' || lost.category_id !== item.category_id ||
          lost.author_id === item.author_id || (lost.recovery_for_id && lost.recovery_for_id !== item.id)) throw new HttpError(409, 'A perda selecionada não pode ser vinculada a este item.');
        name = lost.author_name;
      } else {
        name = plain(input.recipientName, 'o nome para a reserva', 2, 90);
      }
      statements = [db(env, `UPDATE items SET status = 'reserved', reservation_name = ?, reserved_lost_id = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND updated_at = ? AND status = 'open' AND archived_at IS NULL AND (? IS NULL OR EXISTS (
          SELECT 1 FROM items WHERE id = ? AND kind = 'lost' AND status = 'open' AND archived_at IS NULL AND category_id = ?))`,
        name, lostId, user.id, time, ...version, lostId, lostId, item.category_id)];
      break;
    }
    case 'reopen': {
      if (item.archived_at || item.status !== 'reserved') throw new HttpError(409, 'Este item não está reservado.');
      statements = [
        db(env, `UPDATE items SET status = 'open', reservation_name = NULL, reserved_contact_id = NULL,
          reserved_lost_id = NULL, updated_by = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND status = 'reserved'`, user.id, time, ...version),
        db(env, `UPDATE contacts SET status = 'pending', updated_at = ? WHERE item_id = ? AND status = 'approved'
          AND EXISTS(SELECT 1 FROM items WHERE id = ? AND updated_at = ? AND status = 'open')`, time, item.id, item.id, time)
      ];
      break;
    }
    case 'receive': {
      if (item.kind !== 'found' || item.custody !== 'finder' || item.status === 'returned' || item.archived_at) {
        throw new HttpError(409, 'Este item não pode ser recebido pelo setor.');
      }
      statements = [db(env, "UPDATE items SET custody = 'campus', updated_by = ?,updated_at = ? WHERE id = ? AND updated_at = ? AND archived_at IS NULL", user.id, time, ...version)];
      break;
    }
    default: throw new HttpError(400, 'Selecione uma ação válida.');
  }
  try {
    const result = await env.DB.batch(statements);
    if (!result[0].meta.changes) throw new HttpError(409, 'O registro mudou. Atualize a página.');
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe um registro idêntico ativo.');
    throw error;
  }
  return json({});
}

export async function lostCandidates(env, itemId) {
  const item = await loadItem(env, itemId);
  if (!item || item.kind !== 'found') throw new HttpError(404, 'Item encontrado não localizado.');
  const rows = await all(env, `SELECT i.id,i.title,i.occurred_on AS occurredOn,u.name FROM items i JOIN users u ON u.id = i.author_id
    WHERE i.kind = 'lost' AND i.status = 'open' AND i.archived_at IS NULL AND i.category_id = ? AND i.author_id <> ?
    AND (i.recovery_for_id IS NULL OR i.recovery_for_id = ?) ORDER BY abs(julianday(i.occurred_on) - julianday(?)), i.created_at DESC LIMIT 50`,
    item.category_id, item.author_id, item.id, item.occurred_on);
  return json({ items: rows });
}

export async function users(env, search) {
  const q = plain(search.get('q'), 'a busca', 0, 100).toLowerCase();
  const page = Math.max(1, Math.min(10000, Number.parseInt(search.get('page'), 10) || 1));
  const params = [q, q];
  const where = "WHERE instr(lower(name),?) > 0 OR instr(lower(email),?) > 0";
  const [rows, count] = await env.DB.batch([
    db(env, `SELECT id,name,role,active,created_at AS createdAt,
      CASE WHEN email LIKE '%@identity.invalid' THEN '' ELSE email END AS email FROM users ${where} ORDER BY created_at DESC LIMIT 20 OFFSET ?`,
      ...params, (page - 1) * 20),
    db(env, `SELECT count(*) AS total FROM users ${where}`, ...params)
  ]);
  return json({ items: rows.results, total: count.results[0].total, page, perPage: 20 });
}

export async function editUser(env, user, targetId, input) {
  targetId = id(targetId);
  if (user.id === targetId) throw new HttpError(400, 'Peça a outro administrador para alterar sua conta.');
  const target = await first(env, 'SELECT id,role,active FROM users WHERE id = ?', targetId);
  if (!target) throw new HttpError(404, 'Usuário não encontrado.');
  const role = ['user','admin'].includes(input.role) ? input.role : target.role;
  const active = typeof input.active === 'boolean' ? Number(input.active) : target.active;
  if (role === target.role && active === target.active) return json({});
  const [status] = await env.DB.batch([
    db(env, "UPDATE users SET role = ?, active = ? WHERE id = ? AND role = ? AND active = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND active = 1)",
      role, active, targetId, target.role, target.active, user.id),
    db(env, 'DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND active = ?)', targetId,targetId,role,active),
    db(env, 'DELETE FROM password_resets WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND active = ?)', targetId,targetId,role,active)
  ]);
  if (!status.meta.changes) throw new HttpError(409, 'A conta mudou. Atualize a página.');
  return json({});
}

export async function adminSettings(env) {
  const [settings, categories, locations] = await env.DB.batch([
    db(env, 'SELECT sector_phone AS phone,sector_location AS location,sector_hours AS hours,review_required AS review FROM settings WHERE id = 1'),
    db(env, 'SELECT id,name,active FROM categories ORDER BY rowid'),
    db(env, 'SELECT id,name,active FROM locations ORDER BY rowid')
  ]);
  return json({ settings: settings.results[0], categories: categories.results, locations: locations.results });
}

export async function updateSettings(env, input) {
  await run(env, 'UPDATE settings SET sector_phone = ?, sector_location = ?, sector_hours = ?, review_required = ? WHERE id = 1',
    phone(input.phone, false), plain(input.location, 'o local do setor', 2, 120), plain(input.hours, 'o horário', 0, 150), input.review === true ? 1 : 0);
  return json({});
}

export async function updateCatalog(env, type, key, input) {
  const table = type === 'categories' ? 'categories' : 'locations';
  const name = plain(input.name, 'o nome', 2, 90);
  let result;
  try {
    if (!key) {
      if ((await first(env, `SELECT count(*) AS total FROM ${table}`)).total >= 100) throw new HttpError(409, 'Este catálogo chegou ao limite de 100 entradas.');
      const identifier = `${normalize(name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45) || 'registro'}-${crypto.randomUUID().slice(0,8)}`;
      result = await run(env, `INSERT INTO ${table}(id,name) VALUES (?,?)`, identifier,name);
    } else {
      result = await run(env, `UPDATE ${table} SET name = ?,active = ? WHERE id = ?
        AND (? = 1 OR EXISTS (SELECT 1 FROM ${table} WHERE active = 1 AND id <> ?))`, name,input.active === false ? 0 : 1,key,input.active === false ? 0 : 1,key);
    }
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Esse nome já está no catálogo.');
    throw error;
  }
  if (!result.meta.changes) throw new HttpError(409, 'Deixe pelo menos uma entrada ativa no catálogo.');
  return json({});
}

export async function exportHistory(env, search) {
  const earlier = date(search.get('from'), true);
  const later = date(search.get('to'), true);
  if (earlier && later && earlier > later) throw new HttpError(400, 'A data inicial precisa vir antes da data final.');
  const records = await all(env, `SELECT i.id,i.kind,i.title,c.name AS category,i.location,i.status,i.occurred_on,i.custody,
    r.returned_on,r.recipient_name,r.notes,i.archived_at FROM items i JOIN categories c ON c.id = i.category_id
    LEFT JOIN returns r ON r.item_id = i.id WHERE (? = '' OR i.occurred_on >= ?) AND (? = '' OR i.occurred_on <= ?)
    ORDER BY i.created_at DESC LIMIT 10001`, earlier, earlier, later, later);
  if (records.length > 10000) throw new HttpError(413, 'Selecione um período menor para exportar até 10 mil registros.');
  const cells = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  const status = { open: 'Em aberto', reserved: 'Reservado', returned: 'Devolvido', recovered: 'Recuperado' };
  const csv = [
    ['ID','Tipo','Título','Categoria','Local','Status','Data do registro do objeto','Guarda','Data da devolução','Quem recebeu','Observações','Arquivado'],
    ...records.map(r => [r.id,r.kind === 'found' ? 'Encontrado' : 'Perdido',r.title,r.category,r.location,status[r.status],r.occurred_on,
      r.custody === 'campus' ? 'Fatec' : r.custody === 'finder' ? 'Quem encontrou' : '',r.returned_on,r.recipient_name,r.notes,r.archived_at])
  ].map(row => row.map(cells).join(';')).join('\r\n');
  return new Response('\ufeff' + csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="achaki-historico.csv"', 'Cache-Control': 'no-store'
  } });
}
