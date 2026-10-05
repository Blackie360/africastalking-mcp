# Verification record

Checked on 2026-10-05 with Node 24.21.0. All provider requests in these automated tests use synthetic credentials and mocked responses.

- `npm run check:hosted`: TypeScript checking and compilation passed; 68 configuration, service, stdio protocol, HTTP MCP, encryption, consent and D1 tests passed; one additional real OAuth-library integration test passed; Worker bundle completed.
- `npm test`: all 70 tests passed, including the separate loopback-only USSD HTTP adapter.
- The D1 adapter tests execute the migration against real local SQLite and verify atomic reservations, rate counters and tenant isolation.
- The hosted protocol tests exercise the real MCP HTTP client/handler and separate per-request server instances. They cover same-username sandbox isolation, scopes, live opt-in with mocked production endpoints, origin checks, encryption tampering, consent choices, replay rejection and connection deletion.
- The OAuth test executes the pinned Cloudflare OAuth library with a test-only Node runtime shim and in-memory KV. It checks redirect rejection, consent cookie binding, PKCE verification, token access and revocation. This is not a Workers-runtime or live-client interoperability test. CIMD is unavailable in the Node shim; the deployment template includes the required Workers compatibility flag.

Not yet verified: full browser-to-target-client authorization, regional KV behavior, real runtime CPU limits, refresh behavior end to end, or live SMS/airtime delivery. The public landing page is deployed at https://at.blackielabs.com/. See DEPLOYMENT.md for staging checks and operational limitations. These tests are not a security audit.

## Connection page

The frontend was checked in a real browser at desktop and 390px mobile widths. Both had no horizontal overflow. Client instructions opened and closed with keyboard focus returning to their trigger; copy feedback displayed; browser error logs were empty. The official Cursor install URL rendered the expected server name and endpoint on cursor.com. Installation inside Cursor and authorization inside any client were not completed. Claude, ChatGPT and Codex have manual guides, not fabricated auto-install links.

A separate Worker-entry integration test verifies that the public root works without credential infrastructure while MCP/OAuth routes remain fail-closed, that the install link contains only the public endpoint, and that inline script/style CSP hashes match. The test runs alongside the OAuth library test. Screenshots are kept outside the source repository.

## Deployed HTTP checks

At https://at.blackielabs.com, the public root returned 200, OAuth authorization-server metadata returned 200 with the exact issuer and PKCE S256, and protected-resource metadata returned 200 with the `/mcp` audience. Unauthenticated MCP access and a forged token returned 401 with the resource-metadata challenge. Cross-origin consent returned 403; malformed authorization and invalid-client token requests were rejected. The encryption-secret binding was verified by name only. No provider credential was read during these checks.

Live-account connections are enabled at the reference deployment after these checks; the generic deployment template intentionally remains sandbox-first. Live mode still requires each user's production credential, explicit consent and allowlist. No production provider request or paid transaction was performed. Real-client OAuth completion, refresh/revocation across regions and live delivery are not claimed. Successful public requests and deployment startup time do not establish per-request Free-plan CPU compliance.

## Hosted onboarding simplification (2026-10-05)

The hosted connection path now leads the README. Cursor uses its documented native install link with a web fallback. Sandbox consent needs only the API key and read-only check consent; live fields appear when selected, and sending stays unchecked. Copyable remote JSON and a first-preview prompt are available on the landing page. Self-hosted Codex instructions use the deployed origin.

Regression tests verify install-link payloads, custom-origin configuration, escaped client metadata, exact onboarding CSP hashes, and sandbox/live form transitions including clearing live consent. Existing protocol, isolation, consent and provider tests remain applicable. These changes have not been deployed or verified inside real MCP clients. The reference hostname could not be resolved from the editing environment; current live-site availability and the reported Add-button failure remain unconfirmed.
