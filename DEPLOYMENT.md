# Hosted deployment guide

This repository contains a staging adapter and a public connection landing page. The reference deployment is https://at.blackielabs.com/; `/mcp` remains fail-closed until its operator securely completes configuration. Do not enter real credentials until you have verified the deployed origin and completed the checks below. Deployment creates persistent resources and a service that processes other users’ provider credentials; obtain the operator’s approval first.

## Hosted users

Users do not deploy or install this repository. Send them to [the connection page](https://at.blackielabs.com/) to add the hosted endpoint to their client and enter their own provider key during OAuth. Sandbox onboarding fills the username automatically; live onboarding still requires the application username, recipient allowlist and explicit live consent. The Add to Cursor button uses the [documented native install link](https://cursor.com/docs/mcp/install-links), with a web installer and URL/configuration copy fallback. Other clients receive explicit instructions rather than unsupported install links.

Client installation and OAuth connection are separate steps. Confirm installation, then start the client’s Connect/login flow. A functioning button alone does not establish OAuth interoperability. DCR-only clients remain unsupported by this deployment; do not bypass consent or PKCE to make installation appear successful.

## Dedicated resources

Use a dedicated Cloudflare Worker, D1 database and Workers KV namespace. Do not reuse another application’s database, OAuth store or encryption key. Start on the Free plan only when its current limits fit your tests; do not assume the OAuth and encryption work fits its CPU budget. No paid upgrade is required by these instructions.

1. Install a reviewed Wrangler release and authenticate through its secure browser flow with the account owner’s approval. This repository does not include Cloudflare credentials or an operational Wrangler configuration.
2. Create a D1 database and KV namespace using Wrangler or the dashboard. Copy `wrangler.example.jsonc` to ignored `wrangler.jsonc`; enter their resource IDs. Set `PUBLIC_ORIGIN` to the exact HTTPS origin, with no trailing slash. Its `/mcp` path is the resource audience. Keep `nodejs_compat` and `global_fetch_strictly_public`; the latter is required for safe client metadata fetching.
3. Apply `migrations/0001_hosted.sql` through D1 migrations. Bind the database as `DB` and KV as `OAUTH_KV`.
4. Generate a cryptographically random 32-byte key through an operator-controlled secure workflow. Supply its base64 representation directly to the Workers secret binding `CREDENTIAL_ENCRYPTION_KEY`, using a masked/local secret input or a secret manager. Never print it, commit it, put it in `vars`, paste it in chat, or use it as a tool argument. Set the non-secret `CREDENTIAL_KEY_ID` to a version label such as `v1`. This code never generates a deployment key automatically.
5. Set `ENABLE_PRODUCTION` to `false` for the initial sandbox qualification. Set it to `true` only when ready to offer live connections; each user must still consent separately. No Africa’s Talking API key belongs in Worker configuration.
6. Run `npm ci --ignore-scripts`, `npm run check:hosted`, then deploy with your approved Wrangler configuration. The build script also emits a local inspection bundle; Wrangler builds the TypeScript entry itself.
7. Verify the actual deployed URL before distributing it. Configure your MCP client with that URL ending in `/mcp` and let its OAuth browser flow display the consent page. Enter your own provider key directly in that page.

## Required staging checks

Check OAuth discovery, HTTPS origin and exact resource audience, an unauthenticated `/mcp` challenge, consent cookie/CSRF binding, PKCE code exchange, refresh/revocation, and credential deletion in the actual Workers runtime. Test with the intended MCP clients. The implementation supports client ID metadata documents (CIMD); dynamic client registration is disabled. Clients requiring DCR will need an explicitly reviewed configuration change. Cross-origin browser MCP clients are not enabled by default; native clients with a browser OAuth handoff are the initial target.

Use two separately authorized sandbox connections and confirm isolation. Verify read-only balance access and explicit dry-run previews before approving any sandbox send. Verify every send in the simulator; sandbox acceptance never proves handset delivery. Live testing needs a separate exact paid-action approval and correct provider sender, route and balance readiness. No real-provider transaction is part of the automated suite.

Benchmark CPU, memory, startup and D1/KV operations under the real runtime and expected load. The current unminified bundle is approximately 1.4 MB. Node-based tests cannot establish Workers compatibility or Free-plan CPU sufficiency. Rate-limit responses do not prevent all upstream Cloudflare resource consumption.

## Operations and limitations

- Access tokens expire after 10 minutes; refresh tokens are configured for one day. KV propagation can delay revocation visibility across locations. Do not promise instant OAuth revocation globally.
- `at_disconnect` deletes the encrypted D1 credential for that connection; retained OAuth tokens then cannot access the provider. Revoking a grant separately does not delete its encrypted credential. There is no browser management portal or automatic orphan-credential cleanup yet. Establish a retention and deletion process before a public service launch.
- Rate-limit and reservation rows need periodic retention cleanup; no scheduled cleanup is deployed by this starter. Preserve active reservations. Credential records contain no plaintext key or recipient policy, but database backups still need access control and retention policies.
- The supplied key adapter supports one active key only. Do not simply replace it: old ciphertext would become unreadable. Implement and test a versioned re-encryption migration with secure backup/recovery before rotation. Never regenerate an Africa’s Talking key as a deployment shortcut.
- Observability is disabled in the example. Never enable request-body, Authorization header, credential-form, token or raw provider logging. Audit platform logging/retention separately. No delivery callbacks, spending ledger or daily budget are implemented.
- A connection is an authorization boundary, not a verified person or unique provider account. Reauthorizing can create additional limits. Do not market the limits as fraud prevention or account-wide spending control.

## References

- [Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
