# Security notes

This is an unofficial starter, not a security-audited production gateway.

- Keep API keys in a local environment or secret store. `.env` is ignored and not auto-loaded. Never provide keys as tool arguments.
- Stdio inherits the local machine/user trust boundary. The MCP client can see tool inputs and results; do not connect untrusted clients or models to a funded account.
- Tool annotations are hints, not authorization. Environment gates, local limits and `dryRun` do not prove a human approved a transaction. Configure real per-call host approval before enabling sends.
- Fixed HTTPS provider origins and disabled redirects reduce credential-forwarding risk. Responses have a 64 KiB cap and request timeout; exception bodies, stacks and headers are not returned.
- Results mask phone numbers but input arguments still include full numbers and SMS contents. Review your MCP host's retention, provider data handling, recipient consent and applicable requirements.
- Local duplicate suppression is not durable idempotency. Never automatically retry ambiguous or partially successful transactions. Check the provider dashboard and request/message IDs.
- Airtime cap is per call, excludes fees and resets on every call; SMS has no price cap. Use provider controls plus durable budgets before production automation.
- The USSD example has no verified callback authentication. Keep it loopback-only until you add a secure public gateway and verify the provider's current callback security options.
- Dependencies are pinned and lockfile included. Install with `npm ci --ignore-scripts`. Review dependency updates before applying them.
- Report bugs privately to the maintainer of your copy. Do not post real keys, phone numbers, message contents or account balances in public issues.

## Hosted trust boundary

The host operator can access runtime plaintext and the deployment encryption secret. Encryption at rest is not end-to-end encryption. OAuth tokens contain an opaque connection identifier and environment, not the provider API key. Every authorization gets a new identity; sandbox usernames are never tenant keys. API-key validation proves application access only.

D1 stores AES-GCM ciphertext bound to the tenant and key version. D1 atomic counters and reservations protect per-connection limits across requests. Connection recreation, payload changes and elapsed reservation TTL can bypass these limited controls. Neither HTTP timeouts nor provider acceptance establish final transaction outcome.

The OAuth library validates clients, redirects, consent cookie binding, PKCE and tokens. The application enforces exact origin/resource, explicit production and send consent, fixed provider endpoints, scopes and durable pre-dispatch reservations. Its authentication page performs only a balance GET during connection setup. The initial deployment still requires real-runtime security and client interoperability testing; local mocks do not certify production readiness.

See DEPLOYMENT.md for KV consistency, deletion, retention, key rotation and logging limitations. For sensitive reports, contact the repository maintainer privately; do not include real credentials or customer data in public issues.
