import { z } from 'zod';
import { moneySchema, phoneSchema } from './config.js';
const dryRun = z.boolean().default(true).describe('Defaults to true. Set false only for a user-authorized transaction; server policy gates still apply.');
const unique = (values: string[]) => new Set(values).size === values.length;
export const smsSchema = z.strictObject({
  recipients: z.array(phoneSchema).min(1).max(10).refine(unique, 'Duplicate recipients are not allowed'),
  message: z.string().min(1).max(1600).refine(value => value.trim().length > 0, 'Message must not be blank').refine(value => !value.includes('\0'), 'Message cannot contain NUL'),
  senderId: z.string().min(1).max(20).regex(/^[A-Za-z0-9 _+.-]+$/).optional().describe('Optional registered sender ID or shortcode; provider rules vary by market.'),
  dryRun,
});
export const airtimeSchema = z.strictObject({
  recipients: z.array(z.strictObject({
    phoneNumber: phoneSchema,
    amount: moneySchema.describe('Positive amount as a decimal string, e.g. "10.00"; at most 2 decimal places.'),
  })).min(1).max(10).refine(values => unique(values.map(value => value.phoneNumber)), 'Duplicate recipients are not allowed'),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).describe('Must match the configured AT_AIRTIME_CURRENCY.'),
  dryRun,
});
export type SmsInput = z.infer<typeof smsSchema>;
export type AirtimeInput = z.infer<typeof airtimeSchema>;

const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0);
const limit = z.number().int().min(1).max(100).default(20);
const shortCode = z.string().regex(/^\d{1,8}$/);
const keyword = z.string().min(1).max(50).regex(/^[A-Za-z0-9_.-]+$/);
export const inboxSchema = z.strictObject({ lastReceivedId: cursor, limit, includeMessageText: z.boolean().default(false) });
export const subscriptionsSchema = z.strictObject({ shortCode, keyword, lastReceivedId: cursor, limit });
export const subscriptionChangeSchema = z.strictObject({ shortCode, keyword, phoneNumber: phoneSchema, dryRun });
export const transactionSchema = z.strictObject({ transactionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/) });
export const dataSchema = z.strictObject({
  productName: z.string().min(1).max(100).regex(/^[A-Za-z0-9 _.-]+$/),
  recipients: z.array(z.strictObject({ phoneNumber: phoneSchema, quantity: z.number().int().min(1).max(10240), unit: z.enum(['MB','GB']), validity: z.enum(['Day','Week','BiWeek','Month','Quarterly']) })).min(1).max(10).refine(values => unique(values.map(v => v.phoneNumber)), 'Duplicate recipients are not allowed'),
  dryRun,
});
export const ussdPreviewSchema = z.strictObject({ text: z.string().max(1024).default('') });
