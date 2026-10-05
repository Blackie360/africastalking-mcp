import assert from 'node:assert/strict';
import test from 'node:test';
import { fromMinor, loadConfig, moneySchema, phoneSchema, toMinor } from '../src/config.js';
import { SafeError, publicError } from '../src/errors.js';
import { airtimeSchema, smsSchema } from '../src/schemas.js';

const PHONE = '+254700000001';
const SECOND_PHONE = '+254700000002';

test('configuration defaults are sandbox-first, mutation-disabled and immutable', () => {
  const config = loadConfig({});
  assert.deepEqual(config, {
    environment: 'sandbox', username: 'sandbox', apiKey: '', enableMutations: false,
    enableProduction: false, allowedRecipients: [], maxRecipients: 10,
    airtimeCurrency: 'KES', maxAirtimeMinor: 10000, timeoutMs: 15000,
  });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.allowedRecipients));
});

test('configuration parses explicit values and trims and deduplicates the allowlist', () => {
  const config = loadConfig({
    AT_ENVIRONMENT: 'production', AT_USERNAME: 'application_1.test', AT_API_KEY: 'test-secret',
    AT_ENABLE_MUTATIONS: 'true', AT_ENABLE_PRODUCTION: 'true',
    AT_ALLOWED_RECIPIENTS: ` ${PHONE},${SECOND_PHONE}, ${PHONE} `,
    AT_MAX_RECIPIENTS: '2', AT_AIRTIME_CURRENCY: 'USD',
    AT_MAX_AIRTIME_PER_REQUEST: '0.30', AT_TIMEOUT_MS: '100',
    UNRELATED_ENVIRONMENT_VARIABLE: 'ignored',
  });
  assert.deepEqual(config, {
    environment: 'production', username: 'application_1.test', apiKey: 'test-secret',
    enableMutations: true, enableProduction: true, allowedRecipients: [PHONE, SECOND_PHONE],
    maxRecipients: 2, airtimeCurrency: 'USD', maxAirtimeMinor: 30, timeoutMs: 100,
  });
});

for (const [field, values] of Object.entries({
  AT_ENVIRONMENT: ['live', '', 'SANDBOX'],
  AT_USERNAME: ['', 'contains spaces', 'line\nbreak', 'x'.repeat(101)],
  AT_API_KEY: ['has spaces', 'new\nline', 'null\0byte', 'x'.repeat(1001)],
  AT_ENABLE_MUTATIONS: ['TRUE', '1', 'yes', ''],
  AT_ENABLE_PRODUCTION: ['FALSE', '0', 'no', ''],
  AT_MAX_RECIPIENTS: ['0', '-1', '11', '1.5', 'NaN', 'Infinity', ''],
  AT_AIRTIME_CURRENCY: ['kes', 'KE', 'KESS', '123'],
  AT_MAX_AIRTIME_PER_REQUEST: ['0', '0.00', '-1', '1e2', '1.001', '01.00', '1000000000'],
  AT_TIMEOUT_MS: ['99', '60001', '100.1', 'NaN', 'Infinity', ''],
})) {
  test(`invalid ${field} is rejected without disclosing the field value`, () => {
    for (const value of values) {
      assert.throws(() => loadConfig({ [field]: value, PRIVATE_TOKEN: 'never-expose-this' }), error => {
        assert.ok(error instanceof SafeError);
        assert.equal(error.code, 'INVALID_CONFIG');
        assert.match(error.message, new RegExp(field));
        assert.equal(error.message, `Invalid configuration fields: ${field}. See .env.example.`);
        assert.doesNotMatch(JSON.stringify(publicError(error)), /never-expose-this/);
        return true;
      });
    }
  });
}

test('configuration errors list invalid field names without API credentials or input values', () => {
  const secret = 'top-secret-api-key with-invalid-space';
  assert.throws(() => loadConfig({ AT_API_KEY: secret, AT_ENABLE_MUTATIONS: 'definitely-not-a-boolean' }), error => {
    assert.ok(error instanceof SafeError);
    assert.match(error.message, /AT_API_KEY/);
    assert.match(error.message, /AT_ENABLE_MUTATIONS/);
    assert.doesNotMatch(error.message, /top-secret|definitely-not-a-boolean/);
    assert.equal(error.outcomeUnknown, false);
    return true;
  });
});

test('sandbox and production usernames cannot be mixed or omitted in production', () => {
  for (const env of [
    { AT_ENVIRONMENT: 'sandbox', AT_USERNAME: 'real-app' },
    { AT_ENVIRONMENT: 'production' },
    { AT_ENVIRONMENT: 'production', AT_USERNAME: 'sandbox' },
  ]) {
    assert.throws(() => loadConfig(env), error => error instanceof SafeError && error.code === 'INVALID_CONFIG');
  }
  assert.equal(loadConfig({ AT_USERNAME: 'sandbox' }).username, 'sandbox');
});

test('malformed allowlists fail closed and do not reflect their contents', () => {
  for (const value of [`${PHONE},`, `,${PHONE}`, `${PHONE},not-a-phone`, '254700000001', ' ', 'x'.repeat(2001)]) {
    assert.throws(() => loadConfig({ AT_ALLOWED_RECIPIENTS: value }), error => {
      assert.ok(error instanceof SafeError);
      assert.equal(error.code, 'INVALID_CONFIG');
      assert.match(error.message, /AT_ALLOWED_RECIPIENTS/);
      assert.doesNotMatch(error.message, /not-a-phone|254700000001/);
      return true;
    });
  }
});

test('E.164 validation enforces a leading plus, nonzero country prefix and 8–15 digits', () => {
  for (const value of [PHONE, '+12345678', '+123456789012345']) assert.ok(phoneSchema.safeParse(value).success);
  for (const value of ['254700000001', '+012345678', '+1234567', '+1234567890123456', '+254 700000001', '+254-700000001', ` ${PHONE}`, `${PHONE} `, 254700000001]) {
    assert.equal(phoneSchema.safeParse(value).success, false, String(value));
  }
});

test('money validation accepts only positive decimal strings with at most two fractional digits', () => {
  for (const value of ['0.01', '0.1', '1', '10.50', '999999999.99']) assert.ok(moneySchema.safeParse(value).success);
  for (const value of [0, 1, -1, '0', '0.00', '-1', '+1', '.50', '1.', '1.001', '01', '1e2', ' 1', '1 ', 'NaN', 'Infinity', '1000000000']) {
    assert.equal(moneySchema.safeParse(value).success, false, String(value));
  }
  assert.equal(toMinor('0.10') + toMinor('0.20'), 30);
  assert.equal(toMinor('999999999.99'), 99999999999);
  assert.equal(fromMinor(1), '0.01');
  assert.equal(fromMinor(30), '0.30');
  assert.equal(fromMinor(100), '1.00');
});

test('SMS and airtime inputs default to dry-run', () => {
  assert.equal(smsSchema.parse({ recipients: [PHONE], message: 'Hello' }).dryRun, true);
  assert.equal(airtimeSchema.parse({ recipients: [{ phoneNumber: PHONE, amount: '1' }], currencyCode: 'KES' }).dryRun, true);
});

test('SMS validation rejects duplicate recipients, extra fields and invalid content', () => {
  const valid = { recipients: [PHONE], message: 'Hello' };
  for (const raw of [
    { ...valid, recipients: [PHONE, PHONE] }, { ...valid, recipients: [] },
    { ...valid, recipients: Array.from({ length: 11 }, (_, index) => `+2547000000${String(index).padStart(2, '0')}`) },
    { ...valid, message: '' }, { ...valid, message: ' \n\t' }, { ...valid, message: 'a\0b' },
    { ...valid, message: 'a'.repeat(1601) }, { ...valid, dryRun: 'false' },
    { ...valid, senderId: '' }, { ...valid, senderId: 'x'.repeat(21) },
    { ...valid, senderId: 'bad\nsender' }, { ...valid, apiKey: 'caller-supplied-secret' },
    { ...valid, arbitrary: true },
  ]) assert.equal(smsSchema.safeParse(raw).success, false);
  assert.ok(smsSchema.safeParse({ ...valid, senderId: 'Example +1', message: 'a'.repeat(1600), dryRun: false }).success);
});

test('airtime validation rejects duplicate phone numbers, nested extras and numeric amounts', () => {
  const valid = { recipients: [{ phoneNumber: PHONE, amount: '1.00' }], currencyCode: 'KES' };
  for (const raw of [
    { ...valid, recipients: [{ phoneNumber: PHONE, amount: '1' }, { phoneNumber: PHONE, amount: '2' }] },
    { ...valid, recipients: [] },
    { ...valid, recipients: [{ phoneNumber: PHONE, amount: 1 }] },
    { ...valid, recipients: [{ phoneNumber: PHONE, amount: '1.00', currencyCode: 'KES' }] },
    { ...valid, currencyCode: 'kes' }, { ...valid, dryRun: 'false' },
    { ...valid, apiKey: 'caller-supplied-secret' },
  ]) assert.equal(airtimeSchema.safeParse(raw).success, false);
});

test('public errors do not expose arbitrary exception messages or stack traces', () => {
  const secret = 'private-key-do-not-expose';
  assert.deepEqual(publicError(new Error(`Failure using ${secret}`)), {
    code: 'INTERNAL_ERROR', message: 'The operation failed. No diagnostic details were exposed.', outcomeUnknown: false,
  });
});
