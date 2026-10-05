import type { Config } from './config.js';
import { SafeError } from './errors.js';

export type FetchLike = typeof fetch;
export const API_BASES = Object.freeze({
  sandbox: 'https://api.sandbox.africastalking.com/version1',
  production: 'https://api.africastalking.com/version1',
});
const MAX_RESPONSE_BYTES = 65536;

/** Fixed destinations, bounded response, no redirects and no transaction retries. */
export class AfricaTalkingHttp {
  constructor(private readonly config: Config, private readonly fetchFn: FetchLike = fetch) {}

  async request(path: '/user' | '/messaging' | '/airtime/send', fields: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    if (!this.config.apiKey) throw new SafeError('MISSING_CREDENTIALS', 'Set AT_API_KEY in your local environment before calling the provider.');
    if (this.config.environment === 'production' && !this.config.enableProduction) {
      throw new SafeError('PRODUCTION_DISABLED', 'Production network access requires AT_ENABLE_PRODUCTION=true.');
    }
    const mutation = path !== '/user';
    if (signal?.aborted) throw new SafeError('CANCELLED', 'The request was cancelled before dispatch.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const form = new URLSearchParams({ username: this.config.username, ...fields });
      const url = `${API_BASES[this.config.environment]}${path}${mutation ? '' : `?${form}`}`;
      const response = await this.fetchFn(url, {
        method: mutation ? 'POST' : 'GET',
        headers: { apikey: this.config.apiKey, Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(mutation ? { body: form.toString() } : {}),
        signal: combinedSignal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SafeError('PROVIDER_HTTP_ERROR', `Provider returned HTTP ${response.status}. No retry was attempted.${mutation ? ' Verify provider records before retrying.' : ''}`, mutation);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new SafeError('INVALID_RESPONSE', 'The provider returned an empty response.', mutation);
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new SafeError('RESPONSE_TOO_LARGE', 'The provider response exceeded the safety limit. Verify provider records before retrying.', mutation);
        }
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new SafeError('INVALID_RESPONSE', 'The provider returned invalid JSON. Verify provider records before retrying.', mutation);
      }
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError(combinedSignal.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
        `${combinedSignal.aborted ? 'The request timed out or was cancelled.' : 'The provider request failed.'} No retry was attempted.${mutation ? ' The transaction may have been processed; verify provider records before retrying.' : ''}`, mutation);
    } finally {
      clearTimeout(timeout);
    }
  }
}
