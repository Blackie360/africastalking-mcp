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
