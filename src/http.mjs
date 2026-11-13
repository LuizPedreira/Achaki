const textEncoder = new TextEncoder();
const brDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const utf8 = new TextDecoder();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, 'Entre na sua conta para continuar.');
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (user.role !== 'admin') throw new HttpError(403, 'Área reservada à administração.');
  return user;
}

export const now = () => Math.floor(Date.now() / 1000);
export const today = () => brDate.format(new Date());
export const stamp = () => new Date().toISOString();
export const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
export const encode = value => textEncoder.encode(value);
export const decode = bytes => utf8.decode(bytes);

export function plain(value, label, min, max) {
  const clean = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (clean.length < min || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
    throw new HttpError(400, min ? `Informe ${label} com ${min} a ${max} caracteres.` : `Use até ${max} caracteres para ${label}.`);
  }
  return clean;
}

export function email(value) {
  const address = plain(value, 'o e-mail', 5, 254).toLowerCase();
  if (!/^[^\s@<>]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(address)) throw new HttpError(400, 'Informe um e-mail válido.');
  return address;
}

export function phone(value, required = true) {
  if (!required && !value) return '';
  const number = plain(value, 'o telefone', 10, 26);
  if (!/^[+()\d .-]+$/.test(number)) throw new HttpError(400, 'Informe um telefone válido.');
  const digits = number.replace(/\D/g, '');
  if (/^[1-9]\d{9,10}$/.test(digits)) return `55${digits}`;
  if (/^[1-9]\d{11,14}$/.test(digits)) return digits;
  throw new HttpError(400, 'Informe o telefone com DDD.');
}

export function date(value, optional = false) {
  if (optional && !value) return '';
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Informe uma data válida.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > today()) {
    throw new HttpError(400, 'Informe uma data válida que já ocorreu.');
  }
  return value;
}

export function id(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new HttpError(404, 'Registro não encontrado.');
  return value.toLowerCase();
}

export function choice(value, options, label) {
  if (!options.includes(value)) throw new HttpError(400, `Selecione ${label}.`);
  return value;
}

export function pageOf(search) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(search.get('page') || '1', 10) || 1));
  return { page, offset: (page - 1) * 12, limit: 12 };
}

export const db = (env, sql, ...params) => env.DB.prepare(sql).bind(...params);
export const first = (env, sql, ...params) => db(env, sql, ...params).first();
export const all = async (env, sql, ...params) => (await db(env, sql, ...params).all()).results;
export const run = (env, sql, ...params) => db(env, sql, ...params).run();

export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers
  } });
}

export function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

export async function requestBytes(request, limit) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > limit) throw new HttpError(413, 'O arquivo ou formulário excede o limite permitido.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'O arquivo ou formulário excede o limite permitido.');
    }
    chunks.push(chunk.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function readJSON(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'Formato de formulário inválido.');
  const bytes = await requestBytes(request, 32768);
  try {
    const body = JSON.parse(decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch {
    throw new HttpError(400, 'Formulário inválido.');
  }
}

export function safePath(value) {
  if (typeof value !== 'string' || !/^\/(?:item\/[a-f0-9-]{36}|novo(?:\/(?:found|lost))?|meus-registros|perfil|configurar-admin|painel(?:\/(?:encontrados|perdidos|solicitacoes|historico|usuarios|configuracoes))?)?$/i.test(value)) return '/';
  return value;
}

export function cookieValue(request, name) {
  const raw = request.headers.get('Cookie') || '';
  return raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

export function makeCookie(request, name, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const age = Number.isInteger(maxAge) ? `; Max-Age=${maxAge}` : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure}${age}`;
}

export function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}

export const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => base64url(await crypto.subtle.digest('SHA-256', encode(value)));

export async function throttle(env, key, maximum, period) {
  const instant = now();
  const record = await first(env, `
    INSERT INTO limits(key,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE min(attempts + 1, ?) END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts`, await digest(key), instant + period, instant, maximum + 1, instant);
  if (record.attempts > maximum) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}

export function clientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

export function secureResponse(response, request) {
  const result = new Response(response.body, { status:response.status,statusText:response.statusText,headers:response.headers });
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  result.headers.set('X-Frame-Options', 'DENY');
  if (new URL(request.url).protocol === 'https:') result.headers.set('Strict-Transport-Security', 'max-age=31536000');
  result.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return result;
}
