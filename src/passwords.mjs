import { pbkdf2 } from 'node:crypto';
import { base64url, fromBase64url } from './http.mjs';

export class PasswordDerivations {
  async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const { password, salt, iterations } = await request.json();
    if (typeof password !== 'string' || password.length > 128 || !/^[A-Za-z0-9_-]{22}$/.test(salt) ||
        !Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
      return new Response(null, { status: 400 });
    }
    const key = await new Promise((resolve, reject) => {
      pbkdf2(password, fromBase64url(salt), iterations, 32, 'sha256', (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    return new Response(base64url(key));
  }
}

export async function derive(env, password, salt, iterations) {
  const shard = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
  const stub = env.PASSWORDS.get(env.PASSWORDS.idFromName(String(shard)));
  const response = await stub.fetch(new Request('https://passwords.internal/', {
    method: 'POST', body: JSON.stringify({ password, salt:base64url(salt), iterations })
  }));
  if (!response.ok) throw new Error('Password derivation unavailable');
  return fromBase64url(await response.text());
}
