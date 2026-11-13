import { timingSafeEqual } from 'node:crypto';
import {
  HttpError, base64url, clientIP, cookieValue, db, decode, digest, email, encode, first,
  fromBase64url, json, makeCookie, normalize, now, phone, plain, randomToken, redirect,
  requireUser, run, safePath, throttle
} from './http.mjs';
import { derive } from './passwords.mjs';

const sessionCookie = request => new URL(request.url).protocol === 'https:' ? '__Host-achaki_session' : 'achaki_session';
const oauthCookie = request => new URL(request.url).protocol === 'https:' ? '__Host-achaki_oauth' : 'achaki_oauth';
const ITERATIONS = 600_000;
const DUMMY_HASH = `pbkdf2-sha256$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY = 86_400;

export function validPassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128 || value.trim().length < 10) {
    throw new HttpError(400, 'Use uma senha com 10 a 128 caracteres.');
  }
  return value;
}

export async function hashPassword(env, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(env, validPassword(password), salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

async function matchesPassword(env, password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [scheme, count, salt, expected] = (stored || DUMMY_HASH).split('$');
  const iterations = Number(count);
  if (scheme !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
  const actual = await derive(env, password, fromBase64url(salt), iterations);
  return timingSafeEqual(actual, fromBase64url(expected)) && Boolean(stored);
}

export function userView(user) {
  if (!user) return null;
  return {
    id: user.id, name: user.name, email: user.email.endsWith('@identity.invalid') ? '' : user.email,
    phone: user.phone, role: user.role, hasPassword: Boolean(user.password_hash), institutional: Boolean(user.institutional)
  };
}

export async function sessionUser(env, request) {
  const token = cookieValue(request, sessionCookie(request));
  if (!TOKEN.test(token)) return null;
  return first(env, `
    SELECT u.*, EXISTS (SELECT 1 FROM identities x WHERE x.user_id = u.id) AS institutional
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, await digest(token), now());
}

async function newSession(env, request, user, remember) {
  const token = randomToken();
  const duration = remember ? 30 * DAY : DAY;
  const previous = cookieValue(request, sessionCookie(request));
  const changes = [db(env, 'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', await digest(token), user.id, now() + duration)];
  if (TOKEN.test(previous)) changes.push(db(env, 'DELETE FROM sessions WHERE token_hash = ?', await digest(previous)));
  await env.DB.batch(changes);
  return makeCookie(request, sessionCookie(request), token, remember ? duration : undefined);
}

export async function register(env, request, input) {
  await throttle(env, `register:${clientIP(request)}`, 8, 3600);
  const address = email(input.email);
  if (address.endsWith('@identity.invalid')) throw new HttpError(400, 'Informe seu e-mail de contato.');
  const user = {
    id: crypto.randomUUID(), name: plain(input.name, 'seu nome', 2, 90), email: address,
    phone: phone(input.phone), password_hash: await hashPassword(env, input.password), role: 'user'
  };
  try {
    await run(env, 'INSERT INTO users(id,name,email,phone,password_hash) VALUES (?,?,?,?,?)',
      user.id, user.name, user.email, user.phone, user.password_hash);
  } catch (error) {
    if (/unique/i.test(error.message)) throw new HttpError(409, 'Já existe uma conta com esse e-mail.');
    throw error;
  }
  return json({ user: userView(user) }, 201, { 'Set-Cookie': await newSession(env, request, user, false) });
}

export async function login(env, request, input) {
  const address = email(input.email);
  await throttle(env, `login-ip:${clientIP(request)}`, 40, 900);
  await throttle(env, `login-account:${address}`, 10, 900);
  const user = await first(env, `SELECT u.*, EXISTS (SELECT 1 FROM identities x WHERE x.user_id = u.id)
    AS institutional FROM users u WHERE u.email = ?`, address);
  const correct = await matchesPassword(env, input.password, user?.password_hash);
  if (!correct || !user?.active) throw new HttpError(401, 'E-mail ou senha incorretos.');
  return json({ user: userView(user) }, 200, { 'Set-Cookie': await newSession(env, request, user, input.remember === true) });
}

export async function logout(env, request) {
  const token = cookieValue(request, sessionCookie(request));
  if (TOKEN.test(token)) await run(env, 'DELETE FROM sessions WHERE token_hash = ?', await digest(token));
  return json({}, 200, { 'Set-Cookie': makeCookie(request, sessionCookie(request), '', 0) });
}

export async function profile(env, user, input) {
  requireUser(user);
  const name = plain(input.name, 'seu nome', 2, 90);
  const number = phone(input.phone);
  await run(env, 'UPDATE users SET name = ?, phone = ? WHERE id = ?', name, number, user.id);
  return json({ user: userView({ ...user, name, phone: number }) });
}

export async function changePassword(env, request, user, input) {
  requireUser(user);
  await throttle(env, `password:${user.id}`, 8, 3600);
  if (!await matchesPassword(env, input.currentPassword, user.password_hash)) throw new HttpError(400, 'A senha atual está incorreta.');
  const next = await hashPassword(env, input.password);
  const result = await env.DB.batch([
    db(env, 'UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', next, user.id, user.password_hash),
    db(env, 'DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)', user.id, user.id, next),
    db(env, 'DELETE FROM password_resets WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)', user.id, user.id, next)
  ]);
  if (!result[0].meta.changes) throw new HttpError(409, 'Sua senha mudou em outra sessão. Entre novamente.');
  return json({}, 200, { 'Set-Cookie': makeCookie(request, sessionCookie(request), '', 0) });
}

export const emailEnabled = env => Boolean((env.RESEND_API_KEY && env.EMAIL_FROM) || env.MAIL_DEV);
export const ssoEnabled = env => Boolean(/^[a-f0-9-]{36}$/i.test(env.MICROSOFT_TENANT_ID || '') && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);

export async function forgot(env, request, input, context) {
  if (!emailEnabled(env)) throw new HttpError(503, 'A recuperação por e-mail ainda não está disponível. Procure o setor de Achados e Perdidos.');
  const address = email(input.email);
  await throttle(env, `reset-ip:${clientIP(request)}`, 16, 3600);
  await throttle(env, `reset-account:${address}`, 4, 3600);
  const user = await first(env, 'SELECT id FROM users WHERE email = ? AND active = 1 AND password_hash IS NOT NULL', address);
  if (!user) return json({});
  const recentlySent = await first(env, 'SELECT 1 AS sent FROM password_resets WHERE user_id = ? AND expires_at > ?', user.id, now() + 1740);
  if (recentlySent) return json({});

  const token = randomToken();
  const hash = await digest(token);
  const link = new URL('/redefinir-senha', env.APP_ORIGIN || request.url);
  link.hash = token;
  await env.DB.batch([
    db(env, 'DELETE FROM password_resets WHERE user_id = ?', user.id),
    db(env, 'INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (?,?,?)', hash, user.id, now() + 1800)
  ]);
  const delivery = sendReset(env, address, link.href, hash).catch(async () => {
    await run(env, 'DELETE FROM password_resets WHERE token_hash = ?', hash);
    console.warn('Password reset email delivery failed');
  });
  if (context) context.waitUntil(delivery);
  else await delivery;
  return json({});
}

async function sendReset(env, address, link, hash) {
  if (env.MAIL_DEV) return env.MAIL_DEV.send({ to:address, url:link });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `password-reset/${hash}` },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [address], subject: 'Redefina sua senha no Achaki',
      text: `Para escolher uma nova senha no Achaki, abra ${link}\n\nO link vale por 30 minutos. Se você não solicitou a redefinição, ignore este e-mail.`
    })
  });
  if (!response.ok) throw new Error('Email delivery failed');
}

export async function reset(env, request, input) {
  await throttle(env, `reset-apply:${clientIP(request)}`, 20, 900);
  const invalid = () => new HttpError(400, 'Esse link expirou ou já foi usado. Solicite outro link.');
  if (typeof input.token !== 'string' || !TOKEN.test(input.token)) throw invalid();
  const hash = await digest(input.token);
  const record = await first(env, `SELECT p.user_id FROM password_resets p JOIN users u ON u.id = p.user_id
    WHERE p.token_hash = ? AND p.consumed_at IS NULL AND p.expires_at > ? AND u.active = 1`, hash, now());
  if (!record) throw invalid();
  const password = await hashPassword(env, input.password);
  const changed = await env.DB.batch([
    db(env, `UPDATE users SET password_hash = ? WHERE id = ? AND active = 1 AND EXISTS (
      SELECT 1 FROM password_resets WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?)`, password, record.user_id, hash, now()),
    db(env, 'UPDATE password_resets SET consumed_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)', now(), record.user_id, record.user_id, password),
    db(env, 'DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)', record.user_id, record.user_id, password)
  ]);
  if (!changed[0].meta.changes) throw invalid();
  return json({}, 200, { 'Set-Cookie': makeCookie(request, sessionCookie(request), '', 0) });
}

const issuerFor = env => `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID.toLowerCase()}/v2.0`;
const callbackFor = env => new URL('/api/auth/microsoft/callback', env.APP_ORIGIN).href;

export async function startMicrosoft(env, request, url, user) {
  if (!ssoEnabled(env)) throw new HttpError(503, 'O login institucional ainda não foi configurado.');
  await throttle(env, `oauth:${clientIP(request)}`, 20, 900);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const link = url.searchParams.get('link') === '1';
  if (link) requireUser(user);
  await run(env, 'INSERT INTO oauth_states(state_hash,verifier,nonce,user_id,next_path,expires_at) VALUES (?,?,?,?,?,?)',
    await digest(state), verifier, nonce, link ? user.id : null, link ? '/perfil' : safePath(url.searchParams.get('next')), now() + 600);
  const authorize = new URL(issuerFor(env).replace('/v2.0', '/oauth2/v2.0/authorize'));
  authorize.search = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID, response_type: 'code', redirect_uri: callbackFor(env),
    response_mode: 'query', scope: 'openid profile', state, nonce,
    code_challenge: await digest(verifier), code_challenge_method: 'S256', prompt: 'select_account'
  });
  return redirect(authorize.href, { 'Set-Cookie': makeCookie(request, oauthCookie(request), state, 600) });
}

async function microsoftClaims(env, token, nonce) {
  const parts = (token || '').split('.');
  if (parts.length !== 3 || token.length > 20000) throw new Error('Invalid token');
  const [header, claims] = parts.slice(0, 2).map(part => JSON.parse(decode(fromBase64url(part))));
  const issuer = issuerFor(env);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== issuer ||
      claims.aud !== env.MICROSOFT_CLIENT_ID || claims.nonce !== nonce ||
      claims.tid !== env.MICROSOFT_TENANT_ID.toLowerCase() || typeof claims.sub !== 'string' ||
      !Number.isFinite(claims.exp) || !Number.isFinite(claims.nbf) || claims.exp <= now() || claims.nbf > now() + 60) {
    throw new Error('Invalid token claims');
  }
  const keysResponse = await fetch(issuer.replace('/v2.0', '/discovery/v2.0/keys'), { signal: AbortSignal.timeout(8000) });
  if (!keysResponse.ok) throw new Error('Keys unavailable');
  const keys = await keysResponse.json();
  const jwk = keys.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64url(parts[2]), encode(parts.slice(0, 2).join('.')))) throw new Error('Invalid signature');
  return claims;
}

export async function finishMicrosoft(env, request, url, user) {
  const clear = makeCookie(request, oauthCookie(request), '', 0);
  const error = message => redirect(`/entrar?institucional=${message}`, { 'Set-Cookie': clear });
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!ssoEnabled(env) || !code || !TOKEN.test(state || '') || state !== cookieValue(request, oauthCookie(request))) return error('falhou');
  const attempt = await first(env, 'DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING *', await digest(state), now());
  if (!attempt || (attempt.user_id && attempt.user_id !== user?.id)) return error('falhou');
  try {
    const issuer = issuerFor(env);
    const response = await fetch(issuer.replace('/v2.0', '/oauth2/v2.0/token'), {
      method: 'POST', signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
        code, grant_type: 'authorization_code', redirect_uri: callbackFor(env), code_verifier: attempt.verifier
      })
    });
    if (!response.ok) throw new Error('Token unavailable');
    const tokens = await response.json();
    const claims = await microsoftClaims(env, tokens.id_token, attempt.nonce);
    const findIdentity = () => first(env, `SELECT u.* FROM identities x JOIN users u ON u.id = x.user_id
      WHERE x.issuer = ? AND x.subject = ?`, issuer, claims.sub);
    let account = await findIdentity();
    if (attempt.user_id) {
      if (account && account.id !== attempt.user_id) return error('vinculado');
      if (!account) {
        const existing = await first(env, 'SELECT 1 AS linked FROM identities WHERE issuer = ? AND user_id = ?', issuer, user.id);
        if (existing) return error('vinculado');
        await run(env, 'INSERT INTO identities(issuer,subject,user_id) VALUES (?,?,?)', issuer, claims.sub, user.id);
      }
      return redirect('/perfil?institucional=ok', { 'Set-Cookie': clear });
    }
    if (!account) {
      const newId = crypto.randomUUID();
      const cleanName = typeof claims.name === 'string' ? claims.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 90) : '';
      const name = normalize(cleanName).length >= 2 ? cleanName : 'Conta institucional';
      try {
        await env.DB.batch([
          db(env, 'INSERT INTO users(id,name,email) VALUES (?,?,?)', newId, name, `${newId}@identity.invalid`),
          db(env, 'INSERT INTO identities(issuer,subject,user_id) VALUES (?,?,?)', issuer, claims.sub, newId)
        ]);
      } catch (failure) {
        if (!/unique/i.test(failure.message)) throw failure;
      }
      account = await findIdentity();
    }
    if (!account?.active) return error('falhou');
    const headers = new Headers();
    headers.append('Set-Cookie', clear);
    headers.append('Set-Cookie', await newSession(env, request, account, false));
    return redirect(account.phone ? safePath(attempt.next_path) : '/perfil?institucional=novo', headers);
  } catch {
    return error('falhou');
  }
}

export async function bootstrapAdmin(env, request, user) {
  const secret = env.ADMIN_BOOTSTRAP_TOKEN;
  const provided = request.headers.get('Authorization') || '';
  if (!secret || secret.length < 32 || provided.length > 1024) throw new HttpError(404, 'Recurso não encontrado.');
  const actual = encode(await digest(provided));
  const expected = encode(await digest(`Bearer ${secret}`));
  if (!timingSafeEqual(actual, expected)) throw new HttpError(404, 'Recurso não encontrado.');
  requireUser(user);
  const result = await run(env, `UPDATE users SET role = 'admin' WHERE id = ? AND active = 1
    AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`, user.id);
  if (!result.meta.changes) throw new HttpError(409, 'Cadastre a conta antes da promoção. Use o painel se já existir um administrador.');
  return json({ created: true });
}
