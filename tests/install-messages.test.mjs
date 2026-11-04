import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { coreErrorResponse } from '../api/install/_lib.js';
// Se carga como en el navegador (script clásico que publica window/self.SfyInstallMessages).
const sandbox = { self: {} };
vm.runInNewContext(readFileSync(new URL('../instalar/messages.js', import.meta.url), 'utf8'), sandbox);
const { codeErrorMessage } = sandbox.self.SfyInstallMessages;

test('código incorrecto con N real del core', () => {
  const r = coreErrorResponse({ status: 400, data: { error: 'invalid_code', attempts_left: 3, detail: 'Código incorrecto' } });
  assert.deepEqual(r.body, { ok: false, error: 'invalid_code', attempts_left: 3 });
  assert.equal(codeErrorMessage(r.status, r.body), 'Código incorrecto. Te quedan 3 intentos.');
  assert.equal(codeErrorMessage(400, { error: 'invalid_code', attempts_left: 1 }), 'Código incorrecto. Te queda 1 intento.');
});

test('sin intentos y vencido', () => {
  const r = coreErrorResponse({ status: 429, data: { error: 'too_many_attempts', attempts_left: 0 } });
  assert.equal(r.body.error, 'too_many_attempts');
  assert.match(codeErrorMessage(r.status, r.body), /^Ya no quedan intentos/);
  assert.match(codeErrorMessage(410, { error: 'expired' }), /venció/);
  assert.equal(coreErrorResponse({ status: 429, data: {} }).body.error, 'rate_limit');
});
