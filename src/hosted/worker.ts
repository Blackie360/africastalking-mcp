/// <reference types="@cloudflare/workers-types" />
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers, OAuthResourceAuth } from '@cloudflare/workers-oauth-provider';
import { createHash } from 'node:crypto';
import type { HostedConfig, Principal } from './contracts.js';
import { SCOPES } from './contracts.js';
import { createHostedHandler, secureResponse } from './handler.js';
import { EncryptedCredentialStore } from './credentials.js';
import { D1Ciphertexts, D1Controls, DeploymentKeyManagement } from './d1.js';
import { createAuthorizationHandler } from './authorize.js';

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  PUBLIC_ORIGIN: string;
  /** Exact 32-byte base64 key in a Workers secret binding, never a vars value. */
  CREDENTIAL_ENCRYPTION_KEY: string;
  CREDENTIAL_KEY_ID: string;
  ENABLE_PRODUCTION: string;
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      if (!env.DB || !env.OAUTH_KV || !env.PUBLIC_ORIGIN || !env.CREDENTIAL_ENCRYPTION_KEY || !env.CREDENTIAL_KEY_ID) return secureResponse({ error: 'hosting_not_configured' }, 503);
      if (new URL(env.PUBLIC_ORIGIN).origin !== env.PUBLIC_ORIGIN || !env.PUBLIC_ORIGIN.startsWith('https://')) return secureResponse({ error: 'hosting_not_configured' }, 503);
      if (new URL(request.url).origin !== env.PUBLIC_ORIGIN) return secureResponse({ error: 'invalid_host' }, 400);
      const config: HostedConfig = { resource: env.PUBLIC_ORIGIN+'/mcp', authorizationServer: env.PUBLIC_ORIGIN, allowedOrigins: [env.PUBLIC_ORIGIN], productionEnabled: env.ENABLE_PRODUCTION === 'true' };
      const keys = new DeploymentKeyManagement(env.CREDENTIAL_KEY_ID, env.CREDENTIAL_ENCRYPTION_KEY);
      const keyCheck = await keys.encryptionKey(env.CREDENTIAL_KEY_ID); keyCheck.fill(0);
      const credentials = new EncryptedCredentialStore(new D1Ciphertexts(env.DB), keys);
      const controls = new D1Controls(env.DB);
      // Request-level edge IP is supplied by Workers, never forwarded client user-ID headers.
      const address = request.headers.get('CF-Connecting-IP');
      if (!address) return secureResponse({ error: 'edge_context_required' }, 503);
      const edgeKey = createHash('sha256').update(address).digest('hex');
      if (!await controls.consume('edge:'+edgeKey, 'request', 120, 60)) return secureResponse({ error: 'rate_limited' }, 429);
      const provider = new OAuthProvider<Env>({
        apiRoute: '/mcp', authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token',
        // CIMD is preferred. DCR is disabled until target-client interoperability requires it.
        clientIdMetadataDocumentEnabled: true,
        accessTokenTTL: 600, refreshTokenTTL: 86400,
        scopesSupported: [...SCOPES, 'offline_access'], requiredScopes: ['mcp:use'],
        resourceMetadata: { resource: config.resource, authorization_servers: [config.authorizationServer] },
        apiHandler: {
          async fetch(req, _bindings, verifiedContext) {
            // Only OAuthProvider calls this closure after validating the token. No header identities.
            const trusted = verifiedContext as typeof verifiedContext & { auth?: OAuthResourceAuth; props?: { subject?: string } };
            const auth = trusted.auth;
            const subject = trusted.props?.subject;
            const principal: Principal | null = auth && subject && auth.userId === subject && auth.expiresAt ? { issuer: config.authorizationServer, subject, audience: auth.audience, scopes: auth.scope, expiresAt: auth.expiresAt } : null;
            const handler = createHostedHandler(config, {
              credentials, limits: controls, dedupe: controls,
              identity: { verifyAccessToken: async token => auth && token === auth.token ? principal : null, browserSession: async () => null },
            });
            return handler(req as unknown as Request);
          },
        },
        defaultHandler: {
          async fetch(req, bindings) {
            return createAuthorizationHandler(config, { oauth: bindings.OAUTH_PROVIDER, credentials, limits: controls, replay: controls })(req as unknown as Request);
          },
        },
      });
      return await provider.fetch(request, env, ctx) as unknown as Response;
    } catch { return secureResponse({ error: 'service_unavailable' }, 503); }
  },
};
