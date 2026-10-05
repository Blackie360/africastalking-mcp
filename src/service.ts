import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fromMinor, toMinor, phoneSchema, type Config } from './config.js';
import { SafeError } from './errors.js';
import { AfricaTalkingHttp, type FetchLike } from './http.js';
import { smsSchema, airtimeSchema } from './schemas.js';

const mask = (phone: string) => `***${phone.slice(-4)}`;
const textField = z.string().max(1000);
const smsResponse = z.object({ SMSMessageData: z.object({ Recipients: z.array(z.object({
  number: phoneSchema, status: textField, statusCode: z.number().int(), messageId: textField, cost: textField,
})).max(10) }) });
const airtimeResponse = z.object({ errorMessage: z.string().max(5000).optional(), responses: z.array(z.object({
  phoneNumber: phoneSchema, amount: textField, status: textField, requestId: textField, errorMessage: textField.optional(),
})).max(10) });

export class AfricaTalkingService {
  private readonly http: AfricaTalkingHttp;
  private readonly recent = new Map<string, number>();
  constructor(private readonly config: Config, fetchFn?: FetchLike) {
    this.http = new AfricaTalkingHttp(config, fetchFn);
  }
  private clean(value: string) {
    return (this.config.apiKey ? value.split(this.config.apiKey).join('[redacted]') : value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  }
  status() {
    return {
      unofficial: true, environment: this.config.environment, credentialsConfigured: Boolean(this.config.apiKey),
      mutationsEnabled: this.config.enableMutations, productionEnabled: this.config.enableProduction,
      defaultDryRun: true, allowedRecipientCount: this.config.allowedRecipients.length,
      maxRecipients: this.config.maxRecipients, airtimeCurrency: this.config.airtimeCurrency,
      maxAirtimePerRequest: fromMinor(this.config.maxAirtimeMinor), timeoutMs: this.config.timeoutMs,
      automaticRetries: false, duplicateSuppressionSeconds: 300,
    };
  }
  async balance(signal?: AbortSignal) {
    const result = z.object({ UserData: z.object({ balance: z.string().max(100) }) }).safeParse(await this.http.request('/user', {}, signal));
    if (!result.success) throw new SafeError('INVALID_RESPONSE', 'The account response did not match the documented format.');
    return { environment: this.config.environment, balance: this.clean(result.data.UserData.balance) };
  }
  private recipients(phones: string[]) {
    if (phones.length > this.config.maxRecipients) throw new SafeError('RECIPIENT_LIMIT', 'Recipient count exceeds AT_MAX_RECIPIENTS.');
    if (this.config.allowedRecipients.length && phones.some(phone => !this.config.allowedRecipients.includes(phone))) {
      throw new SafeError('RECIPIENT_NOT_ALLOWED', 'One or more recipients are not in AT_ALLOWED_RECIPIENTS.');
    }
  }
  private reserve(operation: string, payload: unknown, signal?: AbortSignal) {
    if (!this.config.enableMutations) throw new SafeError('MUTATIONS_DISABLED', 'Sending requires AT_ENABLE_MUTATIONS=true and dryRun=false.');
    if (this.config.environment === 'production' && (!this.config.enableProduction || this.config.allowedRecipients.length === 0)) {
      throw new SafeError('PRODUCTION_DISABLED', 'Production sends require AT_ENABLE_PRODUCTION=true and a nonempty AT_ALLOWED_RECIPIENTS allowlist.');
    }
    if (!this.config.apiKey) throw new SafeError('MISSING_CREDENTIALS', 'Set AT_API_KEY in your local environment before sending.');
    if (signal?.aborted) throw new SafeError('CANCELLED', 'The request was cancelled before dispatch.');
    const now = Date.now();
    for (const [key, expires] of this.recent) if (expires <= now) this.recent.delete(key);
    const key = createHash('sha256').update(JSON.stringify([operation, payload])).digest('hex');
    if (this.recent.has(key)) throw new SafeError('DUPLICATE_REQUEST', 'An identical send was attempted in this process within 5 minutes. Check provider records before retrying.');
    if (this.recent.size >= 1000) throw new SafeError('SEND_RATE_LIMIT', 'The local send safety cache is full. Wait before starting new sends.');
    // Retained after success, failure and unknown outcome. This is NOT provider idempotency.
    this.recent.set(key, now + 300000);
  }
  async sms(raw: unknown, signal?: AbortSignal) {
    const validated = smsSchema.safeParse(raw);
    if (!validated.success) throw new SafeError('INVALID_INPUT', 'Invalid SMS input. Check recipients, message, senderId and dryRun.');
    const input = validated.data;
    this.recipients(input.recipients);
    const recipients = [...input.recipients].sort();
    const fields = { to: recipients.join(','), message: input.message, bulkSMSMode: '1', enqueue: '0', ...(input.senderId ? { from: input.senderId } : {}) };
    if (input.dryRun) return {
      dryRun: true, sent: false, environment: this.config.environment, recipients: recipients.map(mask),
      recipientCount: recipients.length, messageCharacters: Array.from(input.message).length,
      senderId: input.senderId ?? '(provider default)', note: 'No API request made. This does not validate provider balance, registration, delivery or cost; multipart SMS may cost more.',
    };
    this.reserve('sms', fields, signal);
    const response = smsResponse.safeParse(await this.http.request('/messaging', fields, signal));
    if (!response.success || !sameRecipients(response.data.SMSMessageData.Recipients.map(result => result.number), recipients)) {
      throw new SafeError('INVALID_RESPONSE', 'Unexpected SMS response. Delivery outcome is unknown; check provider records before retrying.', true);
    }
    const results = response.data.SMSMessageData.Recipients.map(result => ({
      recipient: mask(result.number), status: this.clean(result.status), statusCode: result.statusCode,
      accepted: result.statusCode === 101 || result.statusCode === 100 || result.statusCode === 102,
      messageId: this.clean(result.messageId), cost: this.clean(result.cost),
    }));
    return { dryRun: false, environment: this.config.environment, status: summarize(results.map(result => result.accepted)), results,
      note: 'Provider acceptance is not delivery confirmation. Use delivery reports/dashboard; do not retry the entire batch after partial success.' };
  }
  async airtime(raw: unknown, signal?: AbortSignal) {
    const validated = airtimeSchema.safeParse(raw);
    if (!validated.success) throw new SafeError('INVALID_INPUT', 'Invalid airtime input. Check recipients, decimal amounts, currencyCode and dryRun.');
    const input = validated.data;
    this.recipients(input.recipients.map(recipient => recipient.phoneNumber));
    if (input.currencyCode !== this.config.airtimeCurrency) throw new SafeError('CURRENCY_NOT_ALLOWED', 'currencyCode must match AT_AIRTIME_CURRENCY.');
    const totalMinor = input.recipients.reduce((total, recipient) => total + toMinor(recipient.amount), 0);
    if (totalMinor > this.config.maxAirtimeMinor) throw new SafeError('AIRTIME_LIMIT', 'Total airtime exceeds AT_MAX_AIRTIME_PER_REQUEST.');
    const recipients = [...input.recipients].sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber)).map(recipient => ({
      phoneNumber: recipient.phoneNumber, amount: `${input.currencyCode} ${fromMinor(toMinor(recipient.amount))}`,
    }));
    if (input.dryRun) return {
      dryRun: true, sent: false, environment: this.config.environment,
      recipients: recipients.map(recipient => ({ phoneNumber: mask(recipient.phoneNumber), amount: recipient.amount })),
      total: `${input.currencyCode} ${fromMinor(totalMinor)}`,
      note: 'No API request made. The local cap covers requested face value, not fees or aggregate spending; availability and currency support depend on the provider.',
    };
    const fields = { recipients: JSON.stringify(recipients) };
    this.reserve('airtime', fields, signal);
    const response = airtimeResponse.safeParse(await this.http.request('/airtime/send', fields, signal));
    if (!response.success) throw new SafeError('INVALID_RESPONSE', 'Unexpected airtime response. Outcome is unknown; check provider records before retrying.', true);
    if (!sameRecipients(response.data.responses.map(result => result.phoneNumber), recipients.map(recipient => recipient.phoneNumber))) {
      throw new SafeError('INCOMPLETE_RESPONSE', 'Provider did not return a result for every recipient. Check provider records before retrying.', true);
    }
    const results = response.data.responses.map(result => ({
      recipient: mask(result.phoneNumber), amount: this.clean(result.amount), status: this.clean(result.status),
      accepted: result.status === 'Success' || result.status === 'Sent', requestId: this.clean(result.requestId),
      hasProviderError: Boolean(result.errorMessage),
    }));
    return { dryRun: false, environment: this.config.environment, status: summarize(results.map(result => result.accepted)), results,
      hasProviderError: Boolean(response.data.errorMessage), note: 'Keep request IDs for reconciliation. Do not retry an entire partially successful batch.' };
  }
}
function summarize(accepted: boolean[]): 'accepted' | 'partial' | 'failed' {
  if (accepted.length > 0 && accepted.every(Boolean)) return 'accepted';
  return accepted.some(Boolean) ? 'partial' : 'failed';
}

function sameRecipients(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((phone, index) => phone === [...expected].sort()[index]);
}
