import { z } from 'zod';
import { SafeError } from './errors.js';

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an E.164 phone number, including +country code');
export const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/, 'Use a decimal string with at most 2 fractional digits').refine(value => toMinor(value) > 0, 'Amount must be positive');
export function toMinor(value: string): number {
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function fromMinor(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

const booleanString = z.enum(['true', 'false']).transform(value => value === 'true');
const schema = z.object({
  AT_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  AT_USERNAME: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  AT_API_KEY: z.string().max(1000).regex(/^[^\s\u0000-\u001f]*$/).default(''),
  AT_ENABLE_MUTATIONS: booleanString.default(false),
  AT_ENABLE_PRODUCTION: booleanString.default(false),
  AT_ALLOWED_RECIPIENTS: z.string().max(2000).default(''),
  AT_MAX_RECIPIENTS: z.coerce.number().int().min(1).max(10).default(10),
  AT_AIRTIME_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('KES'),
  AT_MAX_AIRTIME_PER_REQUEST: moneySchema.default('100.00'),
  AT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(15000),
});

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))];
    throw new SafeError('INVALID_CONFIG', `Invalid configuration fields: ${fields.join(', ')}. See .env.example.`);
  }
  const value = parsed.data;
  const username = value.AT_USERNAME ?? (value.AT_ENVIRONMENT === 'sandbox' ? 'sandbox' : undefined);
  if (!username || (value.AT_ENVIRONMENT === 'sandbox' && username !== 'sandbox') || (value.AT_ENVIRONMENT === 'production' && username === 'sandbox')) {
    throw new SafeError('INVALID_CONFIG', 'Sandbox requires username sandbox; production requires your production application username.');
  }
  const allowedRecipients = value.AT_ALLOWED_RECIPIENTS ? value.AT_ALLOWED_RECIPIENTS.split(',').map(entry => entry.trim()) : [];
  if (!allowedRecipients.every(phone => phoneSchema.safeParse(phone).success)) {
    throw new SafeError('INVALID_CONFIG', 'AT_ALLOWED_RECIPIENTS must contain comma-separated E.164 phone numbers.');
  }
  return Object.freeze({
    environment: value.AT_ENVIRONMENT,
    username,
    apiKey: value.AT_API_KEY,
    enableMutations: value.AT_ENABLE_MUTATIONS,
    enableProduction: value.AT_ENABLE_PRODUCTION,
    allowedRecipients: Object.freeze([...new Set(allowedRecipients)]),
    maxRecipients: value.AT_MAX_RECIPIENTS,
    airtimeCurrency: value.AT_AIRTIME_CURRENCY,
    maxAirtimeMinor: toMinor(value.AT_MAX_AIRTIME_PER_REQUEST),
    timeoutMs: value.AT_TIMEOUT_MS,
  });
}
export type Config = ReturnType<typeof loadConfig>;
