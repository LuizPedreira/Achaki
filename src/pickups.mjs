import { HttpError, choice, first, id, json, plain, requireUser } from './http.mjs';

// Reabrir a reserva ou trocar a guarda encerra o combinado anterior, mesmo se o pedido voltar a ser aprovado.
export const pickupJoin = `LEFT JOIN audit p ON p.id = (
  SELECT a.id FROM audit a WHERE a.item_id = i.id AND
    (a.action = 'pickup:' || c.id OR a.action IN ('status','custody','archived','restored')) ORDER BY a.id DESC LIMIT 1
)`;
export const pickupColumns = `p.id AS pickup_revision, CASE WHEN p.action = 'pickup:' || c.id THEN p.details END AS pickup_details,
  p.actor_id AS pickup_actor`;
export const eligiblePickup = `c.status = 'approved' AND i.status = 'reserved' AND i.archived_at IS NULL
  AND i.reserved_contact_id = c.id AND i.reserved_lost_id = c.lost_id`;

const context = `FROM contacts c JOIN items i ON i.id = c.item_id JOIN users actor ON actor.id = ? AND actor.active = 1
  ${pickupJoin} WHERE c.id = ? AND (c.requester_id = actor.id OR
    (i.custody = 'finder' AND i.author_id = actor.id) OR (i.custody = 'campus' AND actor.role = 'admin'))`;
const read = (env,userId,contactId) => first(env, `SELECT c.requester_id, i.title, i.custody, (${eligiblePickup}) AS eligible,
  ${pickupColumns} ${context}`, userId,contactId);

const campusClock = new Intl.DateTimeFormat('sv-SE', { timeZone:'America/Sao_Paulo',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
function campusInstant(when) {
  const wall = Date.parse(when + ':00Z');
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = campusClock.format(new Date(instant)).replace(' ','T');
    if (local === when) return new Date(instant);
    instant += wall - Date.parse(local + ':00Z');
  }
  throw new HttpError(400,'Este horário não existe no fuso do campus.');
}
function ensureFuture(when) {
  if (campusInstant(when).getTime() <= Date.now()) throw new HttpError(400,'Escolha um horário futuro no horário de Brasília.');
}
const stale = () => new HttpError(409,'A combinação mudou. Atualize o pedido para ver o horário mais recente.');

function proposedMeeting(input) {
  const when = input.when;
  if (typeof when !== 'string' || !/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(when)) {
    throw new HttpError(400,'Informe o dia e o horário da retirada.');
  }
  const parsed = new Date(when + ':00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,16) !== when) throw new HttpError(400,'Informe uma data de retirada válida.');
  return { when,place:plain(input.place,'o ponto de encontro',2,120).replace(/\s+/g,' ') };
}

function currentEvent(row) {
  return row.pickup_details ? JSON.parse(row.pickup_details) : null;
}

export function pickupView(row) {
  const event = currentEvent(row);
  return {revision:row.pickup_revision || 0,agreed:event?.agreed || null,proposal:event?.proposal || null};
}

function isRetry(row,userId,revision,action,meeting) {
  const last = currentEvent(row);
  return Boolean(last && row.pickup_actor === userId && last.previous === revision && last.action === action &&
    (action !== 'propose' || (last.proposal?.when === meeting.when && last.proposal?.place === meeting.place)));
}

export async function updatePickup(env,user,contactId,input) {
  requireUser(user);
  contactId = id(contactId);
  const row = await read(env,user.id,contactId);
  if (!row) throw new HttpError(404,'Solicitação não encontrada.');
  if (!row.eligible) throw new HttpError(409,'A retirada só pode ser combinada enquanto a reserva estiver aprovada.');
  if (input.custody !== row.custody) throw new HttpError(409,'A guarda do objeto mudou. Atualize o pedido antes de combinar a retirada.');
  const action = choice(input.action,['propose','confirm','dismiss','unschedule'],'uma ação de retirada');
  const revision = input.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new HttpError(400,'A versão do pedido é inválida.');
  const meeting = action === 'propose' ? proposedMeeting(input) : null;
  const state = pickupView(row);
  if (revision !== state.revision) {
    if (isRetry(row,user.id,revision,action,meeting)) return json({pickup:state});
    throw stale();
  }
  const side = row.requester_id === user.id ? 'requester' : 'custodian';
  let {agreed,proposal} = state;
  switch (action) {
    case 'propose':
      ensureFuture(meeting.when);
      proposal = {...meeting,by:side};
      break;
    case 'confirm':
      if (!proposal) throw new HttpError(409,'Não há um horário aguardando confirmação.');
      if (proposal.by === side) throw new HttpError(403,'A outra parte precisa confirmar a sugestão.');
      ensureFuture(proposal.when);
      agreed = {when:proposal.when,place:proposal.place};
      proposal = null;
      break;
    case 'dismiss':
      if (!proposal) throw stale();
      proposal = null;
      break;
    case 'unschedule':
      if (!agreed) throw stale();
      agreed = null;
      proposal = null;
      break;
  }
  const event = JSON.stringify({previous:revision,action,agreed,proposal});
  const saved = await first(env,`INSERT INTO audit(actor_id,item_id,action,details)
    SELECT actor.id,i.id,'pickup:' || c.id,? ${context} AND ${eligiblePickup} AND i.custody = ?
      AND COALESCE(p.id,0) = ? RETURNING id`,event,user.id,contactId,row.custody,revision);
  if (!saved) {
    const current = await read(env,user.id,contactId);
    if (current?.eligible && isRetry(current,user.id,revision,action,meeting)) return json({pickup:pickupView(current)});
    throw stale();
  }
  return json({pickup:{revision:saved.id,agreed,proposal}});
}

export function pickupAudit(entry) {
  if (!entry.action.startsWith('pickup:')) return entry;
  const event = JSON.parse(entry.details);
  const label = {propose:'Horário sugerido',confirm:'Retirada combinada',dismiss:'Sugestão retirada',unschedule:'Horário desmarcado'}[event.action];
  const meeting = event.action === 'propose' ? event.proposal : event.action === 'confirm' ? event.agreed : null;
  const date = meeting?.when.slice(0,10).split('-').reverse().join('/');
  return {...entry,action:label,details:meeting ? `${date} às ${meeting.when.slice(11)} · ${meeting.place}` : ''};
}

const calendarText = value => value.replace(/\\/g,'\\\\').replace(/\r\n?|\n/g,'\\n').replace(/([,;])/g,'\\$1');
const utcStamp = date => date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
function foldLine(value) {
  const encoder = new TextEncoder();
  let line = '', bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) { line += '\r\n '; bytes = 1; }
    line += char;
    bytes += size;
  }
  return line;
}

export async function pickupCalendar(env,user,contactId) {
  requireUser(user);
  contactId = id(contactId);
  const row = await read(env,user.id,contactId);
  const agreed = row?.eligible && pickupView(row).agreed;
  if (!agreed) throw new HttpError(404,'Não há uma retirada confirmada para este pedido.');
  const host = new URL(env.APP_ORIGIN).hostname;
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Achados e Perdidos//Retirada//PT-BR',
    'BEGIN:VEVENT','UID:' + contactId + '@' + host,'SEQUENCE:' + row.pickup_revision,'DTSTAMP:' + utcStamp(new Date()),
    'DTSTART:' + utcStamp(campusInstant(agreed.when)),'SUMMARY:' + calendarText('Retirada de ' + row.title),
    'LOCATION:' + calendarText(agreed.place),'END:VEVENT','END:VCALENDAR'];
  return new Response(lines.map(foldLine).join('\r\n') + '\r\n',{headers:{
    'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="retirada.ics"'
  }});
}
