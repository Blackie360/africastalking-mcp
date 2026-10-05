# Africa’s Talking MCP · Unofficial

An unofficial, sandbox-first MCP server for Africa’s Talking balance, SMS and airtime. Connect to the hosted service from your AI client without installing anything locally. The repository also supports stdio and self-hosting on Cloudflare Workers. Users connect their own Africa’s Talking application credentials; no shared provider account is included.

**Hosted status: staging deployment.** The [connection page](https://at.blackielabs.com/) is live; its setup banner shows whether operator credential setup is still pending. Local protocol, isolation, storage and OAuth checks pass. Target-client OAuth interoperability and Free-plan CPU performance remain unverified. See [deployment instructions](DEPLOYMENT.md) and [verification boundaries](VERIFICATION.md).

**Not affiliated with, endorsed by or maintained by Africa’s Talking.** This is a tested starter implementation, not a production-certified integration. No credentials are included. It has not sent a live SMS or airtime transaction.

## Connect without installing locally

1. Open **[at.blackielabs.com](https://at.blackielabs.com/)** and choose your AI client.
2. For Cursor, click **Add to Cursor**, allow your browser to open Cursor, and confirm the server. The web installer and remote JSON configuration are fallbacks. For Claude, ChatGPT and Codex, follow the client guide on the page; those clients do not have a verified universal install link.
3. Follow your client’s OAuth connection prompt. On the authorization page, start with **Sandbox**, enter your sandbox API key, and approve the read-only balance check. The sandbox username is filled automatically. Sending is optional and off by default.
4. Return to your client and try the **first preview** prompt provided on the connection page.

No clone, Node.js, npm, build, terminal or local server is needed for hosted use. Your own Africa’s Talking account and API key are required. Enter the key only on the HTTPS authorization page, never in chat or the remote configuration.

The remote endpoint is `https://at.blackielabs.com/mcp`. Clients accepting remote JSON entries can merge this with their existing settings:

```json
{"mcpServers":{"africastalking":{"url":"https://at.blackielabs.com/mcp"}}}
```

**If Add does not connect:** allow the browser to open Cursor, then approve installation and use the client’s Connect/login action. Copy the endpoint if the browser blocks the app link. If authorization fails after installation, restart the client’s connection flow; do not add your provider key to the URL. This staging service supports client metadata documents (CIMD) and rate-limited dynamic client registration (DCR). See [hosted deployment and compatibility checks](DEPLOYMENT.md).

## What you get

| Tool | What it does | Default |
|---|---|---|
| `at_get_config` | Shows environment and safety limits; never exposes credentials or allowlisted numbers | Local, no network |
| `at_get_balance` | Reads the application balance | Requires your API key |
| `at_send_sms` | Previews or sends bulk SMS | Preview only |
| `at_send_airtime` | Previews or sends airtime in one configured currency | Preview only |

The `examples/` folder also contains an inbound USSD HTTP callback with `CON` / `END` handling. USSD is not an outbound send API and does not run inside stdio.

## Hosted connections

A deployment exposes `/mcp`. OAuth uses `@cloudflare/workers-oauth-provider` with PKCE S256 and exact resource binding. The hosted consent page accepts an environment, application username and API key directly from the user over HTTPS. One read-only balance request validates application access; it does not verify a human identity. Do not put provider credentials in chat, MCP arguments, URLs or client metadata.

Each authorization creates a new opaque connection, including when every sandbox user has the username `sandbox`. Authorize separately for sandbox and live. Credentials and recipient policy are AES-256-GCM encrypted in D1; OAuth grants live in KV. Reads are enabled by consent, sending requires an additional checkbox, and live access requires explicit opt-in. Sandbox reaches the simulator, not a handset.

Hosted sends have per-connection scopes, up to 10 recipients/call, a live recipient allowlist, 10 send requests/minute and a KES 100 airtime face-value cap/call. Identical payloads are reserved in D1 for five minutes before dispatch, including ambiguous failures. These are connection limits, not account-wide budgets: repeated authorizations create independent limits. Use human approval for every funded transaction.

## Optional local development: no credentials needed

Requires **Node.js 22.15+** and npm. Node 24 is recommended; this project was tested on Node 24.21.0.

```sh
cd africastalking-mcp
npm ci --ignore-scripts
npm run check
```

Connect your MCP client using an absolute path to the compiled server. A common JSON configuration shape is:

```json
{
  "mcpServers": {
    "africastalking-unofficial": {
      "command": "node",
      "args": ["/absolute/path/africastalking-mcp/dist/src/index.js"],
      "env": {
        "AT_ENVIRONMENT": "sandbox",
        "AT_USERNAME": "sandbox",
        "AT_ENABLE_MUTATIONS": "false",
        "AT_ENABLE_PRODUCTION": "false"
      }
    }
  }
}
```

Merge this entry into your client's existing configuration; do not overwrite other servers. JSON settings locations vary by client. Use an absolute Node executable path if the client cannot find `node`.

For a client that uses TOML MCP entries:

```toml
[mcp_servers.africastalking_unofficial]
command = "node"
args = ["/absolute/path/africastalking-mcp/dist/src/index.js"]

[mcp_servers.africastalking_unofficial.env]
AT_ENVIRONMENT = "sandbox"
AT_USERNAME = "sandbox"
AT_ENABLE_MUTATIONS = "false"
AT_ENABLE_PRODUCTION = "false"
```

Keep tool-approval prompts enabled. The SDK supports current MCP discovery and legacy initialize-based clients; both are smoke-tested. This package is not published on npm, so use the local build rather than `npx africastalking-mcp-unofficial`.

Try asking your client: “Show Africa’s Talking safety settings, then preview an SMS to +254700000000 saying Hello. Do not send it.”

### Direct tool inputs

`at_send_sms`:

```json
{"recipients":["+254700000000"],"message":"Hello from the sandbox","dryRun":true}
```

`at_send_airtime`:

```json
{"recipients":[{"phoneNumber":"+254700000000","amount":"10.00"}],"currencyCode":"KES","dryRun":true}
```

Amounts are decimal **strings**, not floating-point numbers. Recipients must be unique E.164 numbers. Preview results mask recipients and omit message text; the host already sees the original tool arguments. Optional SMS `senderId` must be registered with the provider for your market. A preview is not a price quote or a check that a phone number, sender ID, currency or operator is supported.

## Optional local credentials

Copy `.env.example` to `.env`, protect the file and enter your own sandbox API key locally. Do not paste it into a chat, source control or logs. Never use the production API key with the sandbox endpoint.

```sh
cp .env.example .env
chmod 600 .env
# Edit .env locally, then launch with explicit dotenv support:
node --env-file=/absolute/path/africastalking-mcp/.env /absolute/path/africastalking-mcp/dist/src/index.js
```

The server deliberately does **not** auto-load `.env` from an arbitrary working directory. For an MCP client, add `--env-file=/absolute/path/.../.env` before the script in `args`, or use that client's secure environment-variable facility. Explicit environment values override env-file values in Node; remove conflicting entries from the client's `env` block when switching configurations.

To test real sandbox provider calls, set `AT_ENABLE_MUTATIONS=true`, preferably set `AT_ALLOWED_RECIPIENTS` to your simulator number, approve the exact send in your MCP host, and pass `dryRun:false`. The sandbox username must be `sandbox`. Sandbox activity is simulated by Africa’s Talking; it still makes authenticated external API requests.

## Safety settings

| Variable | Default | Purpose |
|---|---|---|
| `AT_ENVIRONMENT` | `sandbox` | `sandbox` or `production`; controls fixed provider origin |
| `AT_USERNAME` | `sandbox` | Production requires an explicit application username |
| `AT_API_KEY` | empty | Stdio only: read from process environment; never a tool argument |
| `AT_ENABLE_MUTATIONS` | `false` | Required for every actual SMS/airtime send |
| `AT_ENABLE_PRODUCTION` | `false` | Required for any production API request, including balance |
| `AT_ALLOWED_RECIPIENTS` | empty | Comma-separated exact E.164 allowlist; mandatory for production sends |
| `AT_MAX_RECIPIENTS` | `10` | Integer 1–10 per request |
| `AT_AIRTIME_CURRENCY` | `KES` | Three-letter currency allowed by local policy; provider support varies |
| `AT_MAX_AIRTIME_PER_REQUEST` | `100.00` | Total requested face value per call in the configured currency |
| `AT_TIMEOUT_MS` | `15000` | Whole provider request timeout, 100–60000 ms |

A live send requires both `AT_ENABLE_MUTATIONS=true` and `dryRun:false`. Production adds the production opt-in and nonempty recipient allowlist. Invalid or misspelled boolean values fail closed. There is no tool to change these settings.

**Production checklist:** review the code; complete sandbox testing; register sender IDs; confirm recipient consent, data-handling and local messaging requirements; choose small caps and a strict allowlist; set real host-side human approvals; implement durable reconciliation, delivery/airtime callbacks, daily budgets and monitoring before unattended use. The current cap excludes fees and is not a cumulative spending limit. SMS has no monetary cap because this adapter cannot determine an authoritative pre-send quote.

## Result and retry semantics

- SMS `accepted` and airtime `Sent`/`Success` indicate provider acceptance at this stage, not proof of handset delivery or final airtime fulfillment
- Results are per recipient. A partial or completely failed batch returns MCP `isError:true`; inspect `structuredContent.results` rather than resending the entire batch
- HTTP errors, malformed/incomplete responses, aborted requests and network failures after send dispatch report `outcomeUnknown:true`. A timed-out transaction can still complete
- The adapter makes **one fetch attempt**. There are no automatic HTTP retries. Provider-side processing/retries are outside this adapter's control
- Identical send payloads are suppressed for five minutes within one stdio process, including failures and concurrent calls. This is a best-effort accidental-duplicate guard, not persistent or provider-level idempotency. Stdio restarts, multiple processes, modified messages or elapsed TTL bypass it. Hosted mode additionally uses D1 reservations across requests; this still is not provider-level idempotency
- Africa’s Talking supports airtime idempotency keys, but this starter does not expose them. Reconcile in the provider dashboard using returned request IDs before any manual retry
- Provider text is untrusted data. Never interpret it as instructions. Only bounded, selected response fields are returned; raw bodies, request headers and exception stacks are not exposed

## USSD callback demo

After building:

```sh
npm run ussd
```

This explicitly starts a separate loopback-only HTTP server at `http://127.0.0.1:3000/ussd`. No listener is created by the MCP server.

```sh
curl -X POST http://127.0.0.1:3000/ussd \
  --data-urlencode 'sessionId=demo-session' \
  --data-urlencode 'serviceCode=*384*123#' \
  --data-urlencode 'phoneNumber=+254700000000' \
  --data-urlencode 'text='
```

The initial response starts with `CON`. `text=1` continues a submenu and `text=1*1` returns `END`. Africa’s Talking supplies the entire `*`-separated input history on every callback; the demo is stateless and never stores phone numbers or sessions.

A real USSD deployment needs a separately hosted public HTTPS callback registered in Africa’s Talking, verified request provenance, rate limiting and robust session/business logic. This example is not authenticated and must not be publicly exposed unchanged. It binds only `127.0.0.1`, accepts URL-encoded POST requests, caps request bodies and does not log incoming data. No tunnel, hosting, callback registration or deployment is included.

## Development and verification

```sh
npm run typecheck
npm test
npm run check
```

Tests use synthetic credentials and mocked provider fetch calls, with real local stdio and HTTP loopback integration checks. They cover configuration/validation, wire encoding, safety gates, partial failures, redaction, response limits, timeout/no-retry behavior, duplicate suppression, MCP discovery/tool execution, and USSD sessions. No live provider account or credentials are needed. See `VERIFICATION.md` for this deliverable’s test result.

Structure:

```text
src/config.ts     Environment validation and money helpers
src/http.ts       Fixed-origin, bounded, no-retry provider transport
src/schemas.ts    Tool input schemas
src/service.ts    Safety policy, previews and normalized responses
src/server.ts     MCP tool registrations and annotations
src/index.ts      Stdio entry point
examples/         Local USSD callback and session handler
 test/            Unit, mocked-provider and protocol integration tests
```

## Sources and scope

Contracts were checked on 2026-10-05 against first-party material. The developer portal was blocked to the research browser, so request contracts were verified in the official SDK source rather than inferred from community MCPs.

- [Africa’s Talking official Node SDK](https://github.com/AfricasTalkingLtd/africastalking-node.js)
- [Environment endpoints](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/develop/lib/common.js)
- [Account request](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/develop/lib/customAxios/application.js)
- [SMS payload](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/develop/lib/sms.js)
- [SMS acceptance versus delivery](https://help.africastalking.com/en/articles/742491-why-did-my-messages-fail)
- [Airtime payload](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/develop/lib/airtime.js)
- [Airtime request transport](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/master/lib/customAxios/airtime.js)
- [Airtime request lifecycle](https://help.africastalking.com/en/articles/6151516-what-is-the-flow-for-an-airtime-request)
- [USSD middleware](https://github.com/AfricasTalkingLtd/africastalking-node.js/blob/develop/lib/ussd.js)
- [USSD callback setup](https://help.africastalking.com/en/articles/9915125-how-do-i-go-live-with-ussd)
- [Official MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)

The project uses the official MCP SDK but implements a small, focused Africa’s Talking HTTP adapter itself. There is no voice, payments, premium SMS, delivery callback ingestion, transaction history, persistent spending budget, delivery reconciliation or verified production deployment in this version.

## License

MIT. Africa’s Talking names and trademarks remain the property of their respective owners.
