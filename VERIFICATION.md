# Verification record

Checked on 2026-10-05 with Node 24.21.0. All provider requests in these automated tests use synthetic credentials and mocked responses.

- `npm run check:hosted`: TypeScript checking and compilation passed; 68 configuration, service, stdio protocol, HTTP MCP, encryption, consent and D1 tests passed; one additional real OAuth-library integration test passed; Worker bundle completed.
- `npm test`: all 70 tests passed, including the separate loopback-only USSD HTTP adapter.
- The D1 adapter tests execute the migration against real local SQLite and verify atomic reservations, rate counters and tenant isolation.
- The hosted protocol tests exercise the real MCP HTTP client/handler and separate per-request server instances. They cover same-username sandbox isolation, scopes, live opt-in with mocked production endpoints, origin checks, encryption tampering, consent choices, replay rejection and connection deletion.
- The OAuth test executes the pinned Cloudflare OAuth library with a test-only Node runtime shim and in-memory KV. It checks redirect rejection, consent cookie binding, PKCE verification, token access and revocation. This is not a Workers-runtime or live-client interoperability test. CIMD is unavailable in the Node shim; the deployment template includes the required Workers compatibility flag.

Not yet verified: configured MCP authentication in the deployed runtime, full browser-to-target-client authorization, regional KV behavior, real runtime CPU limits, refresh behavior end to end, or live SMS/airtime delivery. The public landing page is deployed at https://at.blackielabs.com/. See DEPLOYMENT.md for staging checks and operational limitations. These tests are not a security audit.

## Connection page

The frontend was checked in a real browser at desktop and 390px mobile widths. Both had no horizontal overflow. Client instructions opened and closed with keyboard focus returning to their trigger; copy feedback displayed; browser error logs were empty. The official Cursor install URL rendered the expected server name and endpoint on cursor.com. Installation inside Cursor and authorization inside any client were not completed. Claude, ChatGPT and Codex have manual guides, not fabricated auto-install links.

A separate Worker-entry integration test verifies that the public root works without credential infrastructure while MCP/OAuth routes remain fail-closed, that the install link contains only the public endpoint, and that inline script/style CSP hashes match. The test runs alongside the OAuth library test. Screenshots are kept outside the source repository.
