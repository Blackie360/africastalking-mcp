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

## Authorization interface

The consent page now uses a responsive two-column desktop layout and a single-column mobile form. Synthetic local browser checks at desktop and 390px widths verified no horizontal overflow, keyboard-controlled key visibility, required-field validation, live-field requirements, sandbox reset, and expired-request recovery. Screenshots contain only synthetic client details and empty key inputs. Real user authorization pages or credential contents were not captured.

The hosted suite includes 68 configuration/service/security tests and three OAuth/landing/consent integration checks. CSP hashes cover the exact inline scripts and styles. Client registration uses the OAuth library's DCR endpoint after Cursor reported a DCR compatibility error; real Cursor progressed to Needs Authentication. This does not establish completed provider authorization.

## Hosted onboarding simplification (2026-10-05)

The hosted connection path now leads the README. Cursor uses its documented native install link with a web fallback. Sandbox consent needs only the API key and read-only check consent; live fields appear when selected, and sending stays unchecked. Copyable remote JSON and a first-preview prompt are available on the landing page. Self-hosted Codex instructions use the deployed origin.

Regression tests verify install-link payloads, custom-origin configuration, escaped client metadata, exact onboarding CSP hashes, and sandbox/live form transitions including clearing live consent. Existing protocol, isolation, consent and provider tests remain applicable. These changes have not been deployed or verified inside real MCP clients. The reference hostname could not be resolved from the editing environment; current live-site availability and the reported Add-button failure remain unconfirmed.

## Client buttons and plugin packaging (2026-10-05)

Claude and ChatGPT now have Add actions that copy the remote endpoint and open their setup page. Codex copies the endpoint and shows desktop settings. Guides remain visible without JavaScript. The portable hosted plugin and Codex compatibility package are exposed through a repository marketplace. Tests cover guided-copy success and denial, remote-only plugin definitions, marketplace paths and client handoffs. The full hosted checks, seven OAuth/landing tests and existing 70-test suite passed. Directory approval, public publication and installation in all target clients are not established by these changes.

## Current Cursor design (2026-10-05)

This section supersedes earlier UI descriptions: the public website presents Cursor only. Other client package definitions remain in the source repository. The official Anthropic frontend-design skill was installed project-locally and applied to a blue-and-white messaging workspace design, including the landing, authorization and recovery pages. Local skill installation files are not distributed with this repository.

The current hosted check passes: 68 core tests, six integration tests, type checking, compilation and Worker bundling. Browser checks at 1280px desktop and 390px mobile widths found no horizontal overflow. The manual guide opens with keyboard input and leaves fallback disclosures available; the synthetic consent fixture preserves key visibility control, required production fields and sandbox selection. Expired consent displays safe recovery instructions. Browser error logs were empty. No real authorization state or credential was captured in design screenshots. Cursor provider authorization remains unverified; these frontend checks do not establish end-to-end authentication or paid delivery.

## SPA navigation and single installation action (2026-10-05)

The public frontend now uses a dependency-free hash router with overview, connect, how-it-works and security views. Ordinary navigation changes the visible view in the current document. Direct links such as `/#/connect`, refresh, browser Back/Forward, heading focus, navigation state and unknown-route recovery are covered by a router integration test and browser checks. The Cursor installation group contains only the native Add to Cursor link, whose payload includes only the public MCP URL. The two alternative setup buttons and their unused guide handlers were removed.

The hosted checks pass (68 core tests and seven integration tests, plus TypeScript/build/bundle checks). Desktop and 390px mobile browser checks found no horizontal overflow or console errors. OAuth consent POSTs, credential validation, redirects and Cursor protocol handoff intentionally remain server/external flows. The SPA stores no credentials or tokens in browser storage or routes. Real Cursor authorization remains unverified.

## Expanded tools (2026-10-05)

Eight tools were added for inbound SMS, premium subscription reads/create/delete, mobile-data wallet/transaction/send, and offline USSD demo previews. There are now 12 stdio tools and 13 hosted tools including disconnect. New hosted scopes require reconnecting and checking the corresponding optional permissions; old grants and encrypted records cannot acquire new write access implicitly.

Validation: `npm run check:hosted` passes 81 service/configuration/protocol/storage tests, seven OAuth/landing/router integration tests, TypeScript checks and the Worker bundle. `npm test` passes 83 tests. Added tests cover sandbox/production host separation, method and form/JSON contracts, cursor pagination, redacted message/transaction data, volume and recipient limits, independent opt-ins, old-connection scope rejection, durable duplicate suppression and ambiguous failures without retries. Real stdio discovery covers all new names and credential-free previews.

Provider contracts follow the official Node SDK and response fixtures at commit 7457553651a8a5179ac49fb0f463cfc1a860df25. No live provider calls, paid data sends or subscriber changes were performed. Sandbox/live product provisioning and end-to-end provider availability remain unverified; callback-driven voice, WhatsApp, payments and SIM-swap insights were researched but are not exposed by this change.
