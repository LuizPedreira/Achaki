import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import { base64url } from '../src/http.mjs';
import { PasswordDerivations } from '../src/passwords.mjs';

test('o Durable Object deriva o mesmo hash PBKDF2 de 600 mil iterações', async () => {
  const password = 'Senha de verificação com acentuação';
  const salt = Uint8Array.from({ length:16 }, (_, index) => index);
  const iterations = 600_000;
  const expected = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const response = await new PasswordDerivations().fetch(new Request('https://passwords.internal/', {
    method:'POST', body:JSON.stringify({ password, salt:base64url(salt), iterations })
  }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), base64url(expected));
});
