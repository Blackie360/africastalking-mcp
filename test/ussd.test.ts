import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { handleUssd } from '../examples/ussd-handler.js';
import { createUssdServer } from '../examples/ussd-callback.js';

const fields = { sessionId: 'test-session', serviceCode: '*384*123#', phoneNumber: '+254700000000', text: '' };
test('USSD handles empty, accumulated, terminating, invalid and malformed sessions', () => {
  assert.match(handleUssd(fields), /^CON /);
  assert.match(handleUssd({ ...fields, text: '1' }), /^CON /);
  assert.match(handleUssd({ ...fields, text: '1*1' }), /^END Thanks/);
  assert.match(handleUssd({ ...fields, text: '2' }), /^END Contact/);
  assert.match(handleUssd({ ...fields, text: '3' }), /^END Invalid selection/);
  assert.equal(handleUssd({ text: '' }), 'END Invalid session request.');
});
test('USSD HTTP adapter enforces method, encoding, duplicate fields and body limits', async () => {
  const server = createUssdServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ussd`;
  try {
    const response = await fetch(url, { method: 'POST', body: new URLSearchParams(fields) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
    assert.match(await response.text(), /^CON /);
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(url, { method: 'POST', body: new URLSearchParams([...Object.entries(fields), ['text', '1']]) })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', body: new URLSearchParams({ ...fields, text: 'x'.repeat(9000) }) })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
