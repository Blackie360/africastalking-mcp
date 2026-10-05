import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig } from '../config.js';
import { SafeError } from '../errors.js';
import { createServer } from '../server.js';
import { OPERATIONS, operationUrl, type Operation } from '../operations.js';
import { SCOPES } from './contracts.js';
import type { FetchLike } from '../http.js';
import type { DedupeStore, HostedConfig, IdentityProvider, Principal, RateLimits } from './contracts.js';
import { EncryptedCredentialStore, tenantId } from './credentials.js';

export interface HostedDependencies {
  identity?: IdentityProvider;
  credentials?: EncryptedCredentialStore;
  limits?: RateLimits;
  dedupe?: DedupeStore;
  providerFetch?: FetchLike;
}
export function secureResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra } });
}
export function validPrincipal(p: Principal | null, config: HostedConfig): p is Principal {
  return !!p && p.issuer === config.authorizationServer && p.audience === config.resource &&
    typeof p.subject === 'string' && p.subject.length > 0 && p.subject.length < 256 &&
    Number.isFinite(p.expiresAt) && p.expiresAt > Date.now() / 1000 && p.scopes.includes('mcp:use');
}
export function validateHostedConfig(config: HostedConfig): URL {
  const url = new URL(config.resource), issuer = new URL(config.authorizationServer);
  if (url.protocol !== 'https:' || issuer.protocol !== 'https:' || url.pathname !== '/mcp' ||
      url.search || url.hash || url.username || url.password || issuer.search || issuer.hash || issuer.username || issuer.password ||
      config.allowedOrigins.some(origin => new URL(origin).origin !== origin || !origin.startsWith('https://'))) throw new Error('Invalid hosted configuration');
  return url;
}

/** Stateless HTTP MCP. All authorization precedes server creation or provider access. */
export function createHostedHandler(config: HostedConfig, deps: HostedDependencies) {
  const resource = validateHostedConfig(config);
  const metadata = `${resource.origin}/.well-known/oauth-protected-resource/mcp`;
  const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}", scope="mcp:use"` };
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.origin !== resource.origin || url.search || url.hash) return secureResponse({ error: 'invalid_request' }, 400);
      const origin = request.headers.get('origin');
      if (origin && !config.allowedOrigins.includes(origin)) return secureResponse({ error: 'origin_denied' }, 403);
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp' && request.method === 'GET') {
        return secureResponse({ resource: config.resource, authorization_servers: [config.authorizationServer], scopes_supported: [...SCOPES], bearer_methods_supported: ['header'] });
      }
      if (url.pathname !== '/mcp') return secureResponse({ error: 'not_found' }, 404);
      const { identity, credentials, limits, dedupe } = deps;
      if (!identity || !credentials || !limits || !dedupe) return secureResponse({ error: 'hosting_not_configured' }, 503);
      const authorization = request.headers.get('authorization') ?? '';
      if (!/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(authorization) || authorization.length > 8192) return secureResponse({ error: 'unauthorized' }, 401, challenge);
      const p = await identity.verifyAccessToken(authorization.slice(7));
      if (!validPrincipal(p, config)) return secureResponse({ error: 'unauthorized' }, 401, challenge);
      const tenant = tenantId(p);
      if (!await limits.consume(tenant, 'request', 60, 60)) return secureResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
      if (request.method !== 'POST') return secureResponse({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
      const credential = await credentials.get(tenant);
      if (!credential) return secureResponse({ error: 'connection_required', connect: `${resource.origin}/authorize` }, 403);
      if (credential.environment === 'production' && (!config.productionEnabled || !p.scopes.includes('production:use'))) return secureResponse({ error: 'production_disabled' }, 403);
      const local = loadConfig({
        AT_ENVIRONMENT: credential.environment, AT_USERNAME: credential.username, AT_API_KEY: credential.apiKey,
        AT_ENABLE_MUTATIONS: String(credential.mutationsEnabled || credential.dataMutationsEnabled || credential.subscriptionsEnabled), AT_ENABLE_PRODUCTION: String(config.productionEnabled && credential.productionOptIn),
        AT_ENABLE_DATA_MUTATIONS: String(credential.dataMutationsEnabled), AT_ENABLE_SUBSCRIPTIONS: String(credential.subscriptionsEnabled),
        AT_ALLOWED_RECIPIENTS: credential.allowedRecipients.join(','), AT_MAX_RECIPIENTS: '10',
      });
      const providerFetch: FetchLike = async (input, init) => {
        const target = new URL(String(input));
        const operation = (Object.keys(OPERATIONS) as Operation[]).find(key => {
          const allowed = operationUrl(key, credential.environment);
          return target.origin === allowed.origin && target.pathname === allowed.pathname && init?.method === OPERATIONS[key].method;
        });
        if (!operation || init?.redirect !== 'error') throw new SafeError('DESTINATION_BLOCKED', 'Provider destination blocked.');
        const spec = OPERATIONS[operation];
        if (!p.scopes.includes(spec.scope)) throw new SafeError('SCOPE_REQUIRED', 'Additional operation authorization is required. Reconnect to grant access.');
        // Credential policy is independent of OAuth scopes; old grants cannot gain new writes.
        const writeDisabled = ((spec.scope === 'sms:send' || spec.scope === 'airtime:send') && !credential.mutationsEnabled) ||
          (spec.scope === 'data:send' && !credential.dataMutationsEnabled) ||
          (spec.scope === 'subscriptions:manage' && !credential.subscriptionsEnabled);
        if (writeDisabled) throw new SafeError('MUTATIONS_DISABLED', 'This operation is not enabled for the connection.');
        const path = target.pathname;
        if (spec.mutation) {
          if (!await limits.consume(tenant, 'send', 10, 60)) throw new SafeError('RATE_LIMITED', 'Send rate limit reached; no request dispatched.');
          const digest = createHash('sha256').update(JSON.stringify([credential.environment, target.origin, path, init?.method, init?.body])).digest('hex');
          if (!await dedupe.reserve(tenant, digest, 300)) throw new SafeError('DUPLICATE_REQUEST', 'A matching send was already attempted. Check provider records before retrying.');
        }
        return (deps.providerFetch ?? fetch)(input, init);
      };
      // SDK owns cleanup for its per-request instances. No process-wide shared server/credential.
      const http = createMcpHandler(() => {
        const server = createServer(local, providerFetch);
        server.registerTool('at_disconnect', {
          title: 'Disconnect Africa’s Talking account',
          description: 'Delete only this connection’s encrypted credential. All client tokens for this connection lose provider access. Requires explicit user confirmation.',
          inputSchema: z.strictObject({ confirm: z.literal(true) }),
          annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true, openWorldHint: false },
        }, async () => {
          if (!p.scopes.includes('credentials:manage')) return { isError: true, content: [{ type: 'text', text: 'Connection-management scope required.' }] };
          await credentials.delete(tenant);
          return { content: [{ type: 'text', text: 'Stored connection removed.' }], structuredContent: { environment: credential.environment, disconnected: true } };
        });
        return server;
      }, { legacy: 'stateless', responseMode: 'auto', maxRequestBodySize: 16384, maxSubscriptions: 0, onerror: () => {} });
      const response = await http.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      if (origin) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin'); }
      return new Response(response.body, { status: response.status, headers });
    } catch {
      // Never log exceptions: identity, body, token and provider failures may contain secrets.
      return secureResponse({ error: 'service_unavailable' }, 503);
    }
  };
}
