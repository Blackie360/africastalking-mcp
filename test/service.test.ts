import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, type Config } from '../src/config.js';
import { SafeError, publicError } from '../src/errors.js';
import { AfricaTalkingHttp, type FetchLike } from '../src/http.js';
import { AfricaTalkingService } from '../src/service.js';

const A = '+254700000001';
const B = '+254700000002';
const C = '+254700000003';
const KEY = 'test-api-key-DO-NOT-DISCLOSE';
const smsInput = { recipients: [A], message: 'Hello', dryRun: false };
const airtimeInput = { recipients: [{ phoneNumber: A, amount: '1.00' }], currencyCode: 'KES', dryRun: false };
const config = (env: Record<string, string | undefined> = {}): Config => loadConfig({ AT_API_KEY: KEY, AT_ENABLE_MUTATIONS: 'true', ...env });
const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const smsRecipient = (number = A, statusCode = 101) => ({ number, status: statusCode === 101 ? 'Success' : 'Other status', statusCode, messageId: 'sms-123', cost: 'KES 0.80' });
const smsResponse = (recipients = [smsRecipient()]) => ({ SMSMessageData: { Message: 'Sent', Recipients: recipients } });
const airtimeRecipient = (phoneNumber = A, status = 'Sent') => ({ phoneNumber, amount: 'KES 1.00', status, requestId: 'airtime-123', errorMessage: '' });
const airtimeResponse = (responses = [airtimeRecipient()]) => ({ errorMessage: '', responses });

function recorder(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    assert.ok(init);
    calls.push({ url: String(url), init });
    return reply();
  };
  return { calls, fetchFn };
}

async function rejectsCode(action: () => Promise<unknown>, code: string, outcomeUnknown = false) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof SafeError);
    assert.equal(error.code, code);
    assert.equal(error.outcomeUnknown, outcomeUnknown);
    assert.doesNotMatch(JSON.stringify(publicError(error)), new RegExp(KEY));
    return true;
  });
}

test('status exposes safety defaults but neither credentials nor recipient phone numbers', () => {
  const status = new AfricaTalkingService(loadConfig({ AT_API_KEY: KEY, AT_ALLOWED_RECIPIENTS: A })).status();
  assert.deepEqual(status, {
    unofficial: true, environment: 'sandbox', credentialsConfigured: true,
    mutationsEnabled: false, productionEnabled: false, defaultDryRun: true,
    allowedRecipientCount: 1, maxRecipients: 10, airtimeCurrency: 'KES',
    maxAirtimePerRequest: '100.00', timeoutMs: 15000, automaticRetries: false,
    duplicateSuppressionSeconds: 300,
  });
  assert.doesNotMatch(JSON.stringify(status), new RegExp(`${KEY}|${A.slice(1)}`));
});

test('default SMS and airtime calls are credential-free dry runs without network traffic', async () => {
  const { calls, fetchFn } = recorder(() => { throw new Error('Dry run must not fetch'); });
  const service = new AfricaTalkingService(loadConfig({}), fetchFn);
  const sms = await service.sms({ recipients: [B, A], message: 'Hello 🌍' });
  assert.equal(sms.dryRun, true);
  assert.ok('sent' in sms && !sms.sent);
  assert.ok('recipients' in sms);
  assert.deepEqual(sms.recipients, ['***0001', '***0002']);
  assert.equal(sms.messageCharacters, 7);
  const airtime = await service.airtime({ recipients: [{ phoneNumber: B, amount: '0.2' }, { phoneNumber: A, amount: '0.10' }], currencyCode: 'KES' });
  assert.equal(airtime.dryRun, true);
  assert.ok('total' in airtime);
  assert.equal(airtime.total, 'KES 0.30');
  assert.deepEqual(airtime.recipients, [{ phoneNumber: '***0001', amount: 'KES 0.10' }, { phoneNumber: '***0002', amount: 'KES 0.20' }]);
  assert.equal(calls.length, 0);
});

test('invalid inputs fail locally without reflecting message content or issuing a request', async () => {
  const { calls, fetchFn } = recorder(() => json({}));
  const service = new AfricaTalkingService(config(), fetchFn);
  for (const input of [
    { ...smsInput, recipients: [A, A] }, { ...smsInput, recipients: ['254700000001'] },
    { ...smsInput, message: ' \t' }, { ...smsInput, apiKey: KEY },
  ]) await rejectsCode(() => service.sms(input), 'INVALID_INPUT');
  for (const input of [
    { ...airtimeInput, recipients: [{ phoneNumber: A, amount: '0' }] },
    { ...airtimeInput, recipients: [{ phoneNumber: A, amount: '1e2' }] },
    { ...airtimeInput, recipients: [{ phoneNumber: A, amount: '1.001' }] },
    { ...airtimeInput, recipients: [{ phoneNumber: A, amount: 1 }] },
    { ...airtimeInput, recipients: [{ phoneNumber: A, amount: '1' }, { phoneNumber: A, amount: '2' }] },
  ]) await rejectsCode(() => service.airtime(input), 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});

test('recipient allowlist and configured count limits also apply to dry runs', async () => {
  const { calls, fetchFn } = recorder(() => json({}));
  const service = new AfricaTalkingService(config({ AT_ALLOWED_RECIPIENTS: A, AT_MAX_RECIPIENTS: '1' }), fetchFn);
  await rejectsCode(() => service.sms({ recipients: [B], message: 'Hello' }), 'RECIPIENT_NOT_ALLOWED');
  await rejectsCode(() => service.airtime({ recipients: [{ phoneNumber: B, amount: '1' }], currencyCode: 'KES' }), 'RECIPIENT_NOT_ALLOWED');
  await rejectsCode(() => service.sms({ recipients: [A, B], message: 'Hello' }), 'RECIPIENT_LIMIT');
  await rejectsCode(() => service.airtime({ recipients: [{ phoneNumber: A, amount: '1' }, { phoneNumber: B, amount: '1' }], currencyCode: 'KES' }), 'RECIPIENT_LIMIT');
  assert.equal(calls.length, 0);
});

test('mutation, credential, production and allowlist gates fail before dispatch', async () => {
  for (const [env, code] of [
    [{ AT_ENABLE_MUTATIONS: 'false' }, 'MUTATIONS_DISABLED'],
    [{ AT_API_KEY: '' }, 'MISSING_CREDENTIALS'],
    [{ AT_ENVIRONMENT: 'production', AT_USERNAME: 'app', AT_ALLOWED_RECIPIENTS: A }, 'PRODUCTION_DISABLED'],
    [{ AT_ENVIRONMENT: 'production', AT_USERNAME: 'app', AT_ENABLE_PRODUCTION: 'true' }, 'PRODUCTION_DISABLED'],
    [{ AT_ALLOWED_RECIPIENTS: B }, 'RECIPIENT_NOT_ALLOWED'],
  ] as const) {
    const { calls, fetchFn } = recorder(() => json({}));
    const service = new AfricaTalkingService(config(env), fetchFn);
    await rejectsCode(() => service.sms(smsInput), code);
    await rejectsCode(() => service.airtime(airtimeInput), code);
    assert.equal(calls.length, 0);
  }
});

test('balance uses the exact GET query, API key header and fixed sandbox endpoint', async () => {
  const { calls, fetchFn } = recorder(() => json({ UserData: { balance: 'KES 10.00' } }));
  const service = new AfricaTalkingService(config({ AT_ENABLE_MUTATIONS: 'false' }), fetchFn);
  assert.deepEqual(await service.balance(), { environment: 'sandbox', balance: 'KES 10.00' });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://api.sandbox.africastalking.com/version1/user?username=sandbox');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.body, undefined);
  assert.deepEqual(Object.fromEntries(new Headers(call.init.headers)), { accept: 'application/json', apikey: KEY });
  assert.equal(call.init.redirect, 'error');
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.doesNotMatch(call.url, new RegExp(KEY));
});

test('production balance requires its network gate but not mutation permission or an allowlist', async () => {
  const { calls, fetchFn } = recorder(() => json({ UserData: { balance: 'KES 1.00' } }));
  const production = { AT_ENVIRONMENT: 'production', AT_USERNAME: 'my-app', AT_ENABLE_MUTATIONS: 'false' };
  await rejectsCode(() => new AfricaTalkingService(config(production), fetchFn).balance(), 'PRODUCTION_DISABLED');
  await rejectsCode(() => new AfricaTalkingService(config({ AT_API_KEY: '' }), fetchFn).balance(), 'MISSING_CREDENTIALS');
  assert.equal(calls.length, 0);
  await new AfricaTalkingService(config({ ...production, AT_ENABLE_PRODUCTION: 'true' }), fetchFn).balance();
  assert.equal(calls[0]!.url, 'https://api.africastalking.com/version1/user?username=my-app');
});

test('SMS uses sorted E.164 recipients and exact form-encoded provider wire contract', async () => {
  const { calls, fetchFn } = recorder(() => json(smsResponse([smsRecipient(B), smsRecipient(A)])));
  const service = new AfricaTalkingService(config(), fetchFn);
  const message = 'Hello & welcome + 100%\n🌍';
  const result = await service.sms({ recipients: [B, A], message, senderId: 'Test App', dryRun: false });
  assert.equal(result.status, 'accepted');
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, 'https://api.sandbox.africastalking.com/version1/messaging');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, new URLSearchParams({ username: 'sandbox', to: `${A},${B}`, message, bulkSMSMode: '1', enqueue: '0', from: 'Test App' }).toString());
  assert.deepEqual(Object.fromEntries(new Headers(call.init.headers)), { accept: 'application/json', apikey: KEY, 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(call.init.redirect, 'error');
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.doesNotMatch(String(call.init.body), new RegExp(KEY));
});

test('SMS omits the from field when no sender ID is requested', async () => {
  const { calls, fetchFn } = recorder(() => json(smsResponse()));
  await new AfricaTalkingService(config(), fetchFn).sms(smsInput);
  assert.deepEqual([...new URLSearchParams(String(calls[0]!.init.body))], [
    ['username', 'sandbox'], ['to', A], ['message', 'Hello'], ['bulkSMSMode', '1'], ['enqueue', '0'],
  ]);
});

test('airtime uses normalized decimal currency strings in JSON inside a form body', async () => {
  const { calls, fetchFn } = recorder(() => json(airtimeResponse([airtimeRecipient(A), airtimeRecipient(B)])));
  const result = await new AfricaTalkingService(config(), fetchFn).airtime({
    recipients: [{ phoneNumber: B, amount: '0.2' }, { phoneNumber: A, amount: '0.10' }], currencyCode: 'KES', dryRun: false,
  });
  assert.equal(result.status, 'accepted');
  const call = calls[0]!;
  assert.equal(call.url, 'https://api.sandbox.africastalking.com/version1/airtime/send');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, new URLSearchParams({ username: 'sandbox', recipients: JSON.stringify([
    { phoneNumber: A, amount: 'KES 0.10' }, { phoneNumber: B, amount: 'KES 0.20' },
  ]) }).toString());
  assert.deepEqual(Object.fromEntries(new Headers(call.init.headers)), { accept: 'application/json', apikey: KEY, 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(call.init.redirect, 'error');
});

test('production airtime enforces currency and aggregate face-value cap before sending', async () => {
  const { calls, fetchFn } = recorder(() => json(airtimeResponse([airtimeRecipient(A), airtimeRecipient(B)])));
  const service = new AfricaTalkingService(config({ AT_ENVIRONMENT: 'production', AT_USERNAME: 'app', AT_ENABLE_PRODUCTION: 'true', AT_ALLOWED_RECIPIENTS: `${A},${B}`, AT_MAX_AIRTIME_PER_REQUEST: '0.30' }), fetchFn);
  const input = { recipients: [{ phoneNumber: A, amount: '0.10' }, { phoneNumber: B, amount: '0.20' }], currencyCode: 'KES', dryRun: false };
  await rejectsCode(() => service.airtime({ ...input, currencyCode: 'USD' }), 'CURRENCY_NOT_ALLOWED');
  await rejectsCode(() => service.airtime({ ...input, recipients: [{ phoneNumber: A, amount: '0.31' }] }), 'AIRTIME_LIMIT');
  await rejectsCode(() => service.airtime({ ...input, recipients: [{ phoneNumber: A, amount: '0.20' }, { phoneNumber: B, amount: '0.20' }] }), 'AIRTIME_LIMIT');
  assert.equal(calls.length, 0);
  assert.equal((await service.airtime(input)).status, 'accepted');
  assert.equal(calls[0]!.url, 'https://api.africastalking.com/version1/airtime/send');
  assert.equal(new URLSearchParams(String(calls[0]!.init.body)).get('username'), 'app');
});

for (const [codes, expected] of [
  [[101, 101], 'accepted'], [[100, 102], 'accepted'], [[101, 401], 'partial'], [[401, 500], 'failed'],
] as const) {
  test(`SMS status codes ${codes.join('/')} yield ${expected} with per-recipient results`, async () => {
    const { fetchFn } = recorder(() => json(smsResponse([smsRecipient(A, codes[0]), smsRecipient(B, codes[1])])));
    const result = await new AfricaTalkingService(config(), fetchFn).sms({ ...smsInput, recipients: [A, B] });
    assert.equal(result.status, expected);
    assert.ok('results' in result);
    assert.deepEqual(result.results!.map(item => item.accepted), codes.map(code => [100, 101, 102].includes(code)));
    assert.deepEqual(result.results!.map(item => item.recipient), ['***0001', '***0002']);
    assert.match(result.note, /acceptance is not delivery confirmation/);
  });
}

for (const [statuses, expected] of [
  [['Sent', 'Success'], 'accepted'], [['Sent', 'Failed'], 'partial'], [['Failed', 'Failed'], 'failed'],
] as const) {
  test(`airtime statuses ${statuses.join('/')} yield ${expected} with provider-error flags`, async () => {
    const responses = [airtimeRecipient(A, statuses[0]), { ...airtimeRecipient(B, statuses[1]), errorMessage: 'provider diagnostic' }];
    const { fetchFn } = recorder(() => json({ errorMessage: 'batch diagnostic', responses }));
    const result = await new AfricaTalkingService(config(), fetchFn).airtime({ ...airtimeInput, recipients: [{ phoneNumber: A, amount: '1' }, { phoneNumber: B, amount: '1' }] });
    assert.equal(result.status, expected);
    assert.ok('results' in result);
    assert.deepEqual(result.results!.map(item => item.accepted), statuses.map(status => ['Sent', 'Success'].includes(status)));
    assert.equal(result.hasProviderError, true);
    assert.equal(result.results![1]!.hasProviderError, true);
    assert.doesNotMatch(JSON.stringify(result), /provider diagnostic|batch diagnostic/);
  });
}

test('SMS and airtime reject same-length responses with unexpected or duplicate recipients', async () => {
  for (const phones of [[A, C], [A, A], [A, 'invalid-phone']]) {
    const sms = recorder(() => json(smsResponse(phones.map(phone => smsRecipient(phone)))));
    await rejectsCode(() => new AfricaTalkingService(config(), sms.fetchFn).sms({ ...smsInput, recipients: [A, B] }), 'INVALID_RESPONSE', true);
    const airtime = recorder(() => json(airtimeResponse(phones.map(phone => airtimeRecipient(phone)))));
    await assert.rejects(() => new AfricaTalkingService(config(), airtime.fetchFn).airtime({ ...airtimeInput, recipients: [{ phoneNumber: A, amount: '1' }, { phoneNumber: B, amount: '1' }] }), error => {
      assert.ok(error instanceof SafeError);
      assert.ok(['INVALID_RESPONSE', 'INCOMPLETE_RESPONSE'].includes(error.code));
      assert.equal(error.outcomeUnknown, true);
      return true;
    });
  }
});

test('missing and malformed provider result shapes remain unknown mutation outcomes', async () => {
  for (const value of [{}, smsResponse([]), { SMSMessageData: { Recipients: [{ number: A }] } }]) {
    await rejectsCode(() => new AfricaTalkingService(config(), recorder(() => json(value)).fetchFn).sms(smsInput), 'INVALID_RESPONSE', true);
  }
  await rejectsCode(() => new AfricaTalkingService(config(), recorder(() => json(airtimeResponse([]))).fetchFn).airtime(airtimeInput), 'INCOMPLETE_RESPONSE', true);
  await rejectsCode(() => new AfricaTalkingService(config(), recorder(() => json({ responses: [{ phoneNumber: A }] })).fetchFn).airtime(airtimeInput), 'INVALID_RESPONSE', true);
  await rejectsCode(() => new AfricaTalkingService(config(), recorder(() => json({ UserData: { balance: 10 } })).fetchFn).balance(), 'INVALID_RESPONSE');
});

test('HTTP failures do not retry or disclose response bodies, and sends remain duplicate-suppressed', async () => {
  for (const status of [400, 429, 500, 503]) {
    const { calls, fetchFn } = recorder(() => new Response(`Provider echoed ${KEY}`, { status }));
    const service = new AfricaTalkingService(config(), fetchFn);
    await rejectsCode(() => service.sms(smsInput), 'PROVIDER_HTTP_ERROR', true);
    await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
    assert.equal(calls.length, 1);
  }
  const { calls, fetchFn } = recorder(() => new Response(KEY, { status: 503 }));
  await rejectsCode(() => new AfricaTalkingService(config(), fetchFn).balance(), 'PROVIDER_HTTP_ERROR');
  assert.equal(calls.length, 1);
});

test('network failures do not retry, leak exception text or release send reservations', async () => {
  const { calls, fetchFn } = recorder(() => { throw new Error(`Socket failed using ${KEY}`); });
  const service = new AfricaTalkingService(config(), fetchFn);
  await rejectsCode(() => service.airtime(airtimeInput), 'NETWORK_ERROR', true);
  await rejectsCode(() => service.airtime(airtimeInput), 'DUPLICATE_REQUEST');
  assert.equal(calls.length, 1);
});

test('timeout aborts an abort-aware fetch once without retrying and retains unknown outcome', async () => {
  let calls = 0;
  let aborted = false;
  const fetchFn: FetchLike = async (_url, init) => {
    calls += 1;
    const signal = init?.signal;
    assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => { aborted = true; reject(new Error(`Aborted ${KEY}`)); };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };
  const service = new AfricaTalkingService(config({ AT_TIMEOUT_MS: '100' }), fetchFn);
  await rejectsCode(() => service.sms(smsInput), 'REQUEST_ABORTED', true);
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
  assert.equal(calls, 1);
});

test('pre-aborted requests never dispatch or reserve a send', async () => {
  const { calls, fetchFn } = recorder(() => json(smsResponse()));
  const service = new AfricaTalkingService(config(), fetchFn);
  const signal = AbortSignal.abort();
  await rejectsCode(() => service.sms(smsInput, signal), 'CANCELLED');
  await rejectsCode(() => service.balance(signal), 'CANCELLED');
  assert.equal(calls.length, 0);
  assert.equal((await service.sms(smsInput)).status, 'accepted');
  assert.equal(calls.length, 1);
});

test('caller cancellation after dispatch aborts the request and suppresses retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchFn: FetchLike = async (_url, init) => {
    calls += 1;
    assert.ok(init?.signal);
    const signal = init.signal;
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  };
  const service = new AfricaTalkingService(config(), fetchFn);
  const pending = service.sms(smsInput, controller.signal);
  controller.abort();
  await rejectsCode(() => pending, 'REQUEST_ABORTED', true);
  await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
  assert.equal(calls, 1);
});

test('response size limit counts bytes, cancels oversized streams and does not retry', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; },
  });
  const { calls, fetchFn } = recorder(() => new Response(body));
  const service = new AfricaTalkingService(config(), fetchFn);
  await rejectsCode(() => service.sms(smsInput), 'RESPONSE_TOO_LARGE', true);
  assert.equal(cancelled, true);
  await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
  assert.equal(calls.length, 1);
  const utf8 = recorder(() => new Response(JSON.stringify('é'.repeat(33000))));
  await rejectsCode(() => new AfricaTalkingHttp(config(), utf8.fetchFn).request('/user', {}), 'RESPONSE_TOO_LARGE');
});

test('response size boundary allows exactly 65536 bytes', async () => {
  const body = JSON.stringify('x'.repeat(65534));
  assert.equal(Buffer.byteLength(body), 65536);
  const { fetchFn } = recorder(() => new Response(body));
  assert.equal(await new AfricaTalkingHttp(config(), fetchFn).request('/user', {}), 'x'.repeat(65534));
});

test('malformed JSON and empty responses are safe errors with no transaction retry', async () => {
  for (const body of [`malformed JSON ${KEY}`, '', null]) {
    const { calls, fetchFn } = recorder(() => new Response(body));
    const service = new AfricaTalkingService(config(), fetchFn);
    await rejectsCode(() => service.sms(smsInput), 'INVALID_RESPONSE', true);
    await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
    assert.equal(calls.length, 1);
  }
});

test('provider text is API-key redacted, control-character stripped and bounded', async () => {
  const balance = new AfricaTalkingService(config(), recorder(() => json({ UserData: { balance: `KES ${KEY}\n\u0000\u007f 2` } })).fetchFn);
  assert.equal((await balance.balance()).balance, 'KES [redacted] 2');
  const tainted = `${KEY}\n${'x'.repeat(300)}`;
  const sms = new AfricaTalkingService(config(), recorder(() => json(smsResponse([{ ...smsRecipient(), status: tainted, messageId: `${KEY}:${KEY}\r`, cost: tainted }]))).fetchFn);
  const result = await sms.sms(smsInput);
  assert.ok('results' in result);
  assert.equal(result.results![0]!.status.length, 200);
  assert.equal(result.results![0]!.messageId, '[redacted]:[redacted]');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  const airtime = new AfricaTalkingService(config(), recorder(() => json(airtimeResponse([{ ...airtimeRecipient(), amount: tainted, requestId: `${KEY}\n`, errorMessage: KEY }]))).fetchFn);
  const airtimeResult = await airtime.airtime(airtimeInput);
  assert.ok('results' in airtimeResult);
  assert.equal(airtimeResult.results![0]!.requestId, '[redacted]');
  assert.equal(airtimeResult.results![0]!.amount.length, 200);
  assert.doesNotMatch(JSON.stringify(airtimeResult), new RegExp(KEY));
});

test('identical successful SMS sends are locally suppressed even with reordered recipients', async () => {
  const { calls, fetchFn } = recorder(() => json(smsResponse([smsRecipient(A), smsRecipient(B)])));
  const service = new AfricaTalkingService(config(), fetchFn);
  await service.sms({ ...smsInput, recipients: [B, A] });
  await rejectsCode(() => service.sms({ ...smsInput, recipients: [A, B] }), 'DUPLICATE_REQUEST');
  assert.equal(calls.length, 1);
  await service.sms({ ...smsInput, recipients: [A, B], message: 'Different message' });
  assert.equal(calls.length, 2);
});

test('airtime duplicate keys normalize amount spellings and recipient order', async () => {
  const { calls, fetchFn } = recorder(() => json(airtimeResponse([airtimeRecipient(A), airtimeRecipient(B)])));
  const service = new AfricaTalkingService(config(), fetchFn);
  await service.airtime({ ...airtimeInput, recipients: [{ phoneNumber: B, amount: '1' }, { phoneNumber: A, amount: '2.0' }] });
  await rejectsCode(() => service.airtime({ ...airtimeInput, recipients: [{ phoneNumber: A, amount: '2.00' }, { phoneNumber: B, amount: '1.00' }] }), 'DUPLICATE_REQUEST');
  assert.equal(calls.length, 1);
});

test('dry runs do not create reservations and duplicate suppression is process-instance local', async () => {
  const { calls, fetchFn } = recorder(() => json(smsResponse()));
  const first = new AfricaTalkingService(config(), fetchFn);
  await first.sms({ ...smsInput, dryRun: true });
  await first.sms({ ...smsInput, dryRun: true });
  assert.equal(calls.length, 0);
  await first.sms(smsInput);
  await new AfricaTalkingService(config(), fetchFn).sms(smsInput);
  assert.equal(calls.length, 2);
});

test('an in-flight identical send is reserved before awaiting the provider', async () => {
  let release: ((response: Response) => void) | undefined;
  const response = new Promise<Response>(resolve => { release = resolve; });
  const { calls, fetchFn } = recorder(() => response);
  const service = new AfricaTalkingService(config(), fetchFn);
  const first = service.sms(smsInput);
  await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
  assert.equal(calls.length, 1);
  assert.ok(release);
  release(json(smsResponse()));
  assert.equal((await first).status, 'accepted');
  await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
});

test('failed per-recipient sends remain duplicate-suppressed', async () => {
  const { calls, fetchFn } = recorder(() => json(smsResponse([smsRecipient(A, 401)])));
  const service = new AfricaTalkingService(config(), fetchFn);
  assert.equal((await service.sms(smsInput)).status, 'failed');
  await rejectsCode(() => service.sms(smsInput), 'DUPLICATE_REQUEST');
  assert.equal(calls.length, 1);
});
