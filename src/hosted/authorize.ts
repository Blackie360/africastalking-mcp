import { createHash, randomUUID } from 'node:crypto';
import type { OAuthHelpers, AuthRequest } from '@cloudflare/workers-oauth-provider';
import { loadConfig } from '../config.js';
import { AfricaTalkingService } from '../service.js';
import type { FetchLike } from '../http.js';
import { credentialSchema, EncryptedCredentialStore, tenantId } from './credentials.js';
import type { HostedConfig, Principal, RateLimits, DedupeStore } from './contracts.js';
import { SCOPES } from './contracts.js';
import { secureResponse } from './handler.js';
import { onboardingPage } from './onboarding.js';

export function validAuthorization(a: AuthRequest, c: HostedConfig): boolean {
  return a.responseType === 'code' && a.codeChallengeMethod === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(a.codeChallenge ?? '') && a.resource === c.resource && a.scope.includes('mcp:use') && a.scope.every(s => (SCOPES as readonly string[]).includes(s) || s === 'offline_access');
}
async function readForm(request: Request): Promise<URLSearchParams | null> {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  if ([...form.keys()].some(k => form.getAll(k).length !== 1 || !['handle','apiKey','environment','username','mutationsEnabled','productionOptIn','allowedRecipients','consent'].includes(k))) return null;
  return form;
}
export function createAuthorizationHandler(config: HostedConfig, deps: { oauth: OAuthHelpers; credentials: EncryptedCredentialStore; limits: RateLimits; replay: DedupeStore; providerFetch?: FetchLike }) {
  const origin = new URL(config.resource).origin;
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin || url.pathname !== '/authorize') return secureResponse({ error: 'not_found' }, 404);
      if (request.method === 'GET') {
        if (url.searchParams.has('apiKey') || url.searchParams.has('apikey')) return secureResponse({ error: 'invalid_request' }, 400);
        const auth = await deps.oauth.parseAuthRequest(request);
        if (!validAuthorization(auth, config)) return secureResponse({ error: 'invalid_authorization_request' }, 400);
        const description = await deps.oauth.describeConsent(auth);
        const consent = await deps.oauth.beginConsent(auth);
        const headers = new Headers(consent.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8'); headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'no-referrer');
        headers.set('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        headers.set('X-Frame-Options', 'DENY'); headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(onboardingPage(consent.handle, description, config.productionEnabled), { headers });
      }
      if (request.method !== 'POST') return secureResponse({ error: 'method_not_allowed' }, 405);
      if (url.search || request.headers.get('origin') !== origin) return secureResponse({ error: 'csrf_denied' }, 403);
      const form = await readForm(request);
      if (!form || form.get('consent') !== 'true') return secureResponse({ error: 'consent_required' }, 400);
      const handle = form.get('handle') ?? '';
      if (!handle || handle.length > 2048 || !await deps.replay.reserve('oauth-consent', createHash('sha256').update(handle).digest('hex'), 900)) return secureResponse({ error: 'consent_expired_or_used' }, 400);
      // Vetted library binds consent to a browser cookie and consumes it once.
      const granted = ['mcp:use', 'credentials:manage'];
      if (form.get('mutationsEnabled') === 'true') granted.push('sms:send', 'airtime:send');
      if (form.get('environment') === 'production' && form.get('productionOptIn') === 'true') granted.push('production:use');
      const approved = await deps.oauth.approveConsent(request, handle, { scope: granted });
      if (!validAuthorization(approved.request, config)) return secureResponse({ error: 'invalid_authorization_request' }, 400);
      const parsed = credentialSchema.safeParse({ apiKey: form.get('apiKey'), environment: form.get('environment') ?? 'sandbox', username: form.get('username') ?? 'sandbox', mutationsEnabled: form.get('mutationsEnabled') === 'true', productionOptIn: form.get('productionOptIn') === 'true', allowedRecipients: (form.get('allowedRecipients') ?? '').split(',').map(x => x.trim()).filter(Boolean) });
      if (!parsed.success) return secureResponse({ error: 'invalid_connection_settings' }, 400);
      const credential = parsed.data;
      if (credential.environment === 'production' && (!config.productionEnabled || !approved.request.scope.includes('production:use'))) return secureResponse({ error: 'production_scope_required' }, 403);
      if (credential.mutationsEnabled && !approved.request.scope.some(s => s === 'sms:send' || s === 'airtime:send')) return secureResponse({ error: 'send_scope_required' }, 403);
      const rateKey = createHash('sha256').update(approved.request.clientId).digest('hex');
      if (!await deps.limits.consume('login-client:'+rateKey, 'credential', 5, 60)) return secureResponse({ error: 'rate_limited' }, 429);
      const service = new AfricaTalkingService(loadConfig({ AT_ENVIRONMENT: credential.environment, AT_USERNAME: credential.username, AT_API_KEY: credential.apiKey, AT_ENABLE_PRODUCTION: String(credential.productionOptIn), AT_ENABLE_MUTATIONS: 'false' }), deps.providerFetch);
      await service.balance(); // fixed origin, GET, bounded response, no redirects or retries
      const subject = randomUUID(); // opaque connection, NEVER shared sandbox username
      const p: Principal = { issuer: config.authorizationServer, subject, audience: config.resource, scopes: approved.request.scope, expiresAt: Date.now()/1000+600 };
      const tenant = tenantId(p);
      await deps.credentials.put(tenant, credential);
      try {
        const completed = await deps.oauth.completeAuthorization({ request: approved.request, userId: subject, scope: approved.request.scope, metadata: { environment: credential.environment }, props: { subject, environment: credential.environment } });
        const headers = new Headers(approved.headers);
        headers.set('Location', completed.redirectTo); headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'no-referrer');
        return new Response(null, { status: 303, headers });
      } catch { await deps.credentials.delete(tenant); return secureResponse({ error: 'authorization_not_completed' }, 503); }
    } catch {
      return secureResponse({ error: 'connection_not_completed', message: 'Check the selected environment and credentials, then restart authorization. No send was attempted.' }, 400);
    }
  };
}
