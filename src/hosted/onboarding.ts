import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function onboardingPage(handle: string, d: ConsentDescription, productionEnabled: boolean): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Africa’s Talking</title><body><main>
<h1>Connect your Africa’s Talking application</h1>
<p>Client: <strong>${esc(d.clientName)}</strong> ${d.clientDomain ? `(${esc(d.clientDomain)})` : '(client-provided name)'}. Redirect destination: ${esc(d.redirectHost)}.</p>
${d.redirectIsLoopback ? '<p>This returns to a local app. Any local process could be listening; verify the client you started.</p>' : ''}
<p>Client-requested permissions: ${d.scope.map(esc).join(', ')}. You grant account reads and connection removal; sending and live access are optional below.</p>
<p>No Google or GitHub login. Your API key proves application access, not personal identity. Each authorization creates a separate connection. Authorize twice to use both sandbox and live.</p>
<p>This unofficial service stores your key encrypted, never in MCP tokens or chat. Sandbox reaches only the simulator. Live SMS and airtime use your own account balance, rates, sender registrations and recipient eligibility. No shared account or free live SMS is provided.</p>
<form method="post" action="/authorize" autocomplete="off">
<input type="hidden" name="handle" value="${esc(handle)}">
<p><label>Environment <select name="environment"><option value="sandbox">Sandbox (default)</option>${productionEnabled ? '<option value="production">Live / Production</option>' : ''}</select></label></p>
<p><label>Application username <input name="username" value="sandbox" required maxlength="100"></label> For live, enter the live app username.</p>
<p><label>API key for this environment <input type="password" name="apiKey" autocomplete="new-password" required maxlength="1000"></label></p>
<p><label>Allowed recipients (comma-separated, +country code; required for live) <input name="allowedRecipients" maxlength="200"></label></p>
<p><label><input type="checkbox" name="mutationsEnabled" value="true"> Allow SMS and airtime sends I authorize through this client (10 recipients/call, 10 sends/minute, KES 100 airtime face value/call)</label></p>
${productionEnabled ? '<p><label><input type="checkbox" name="productionOptIn" value="true"> Enable live requests and charges to my own account. A registered sender and enough balance may be required.</label></p>' : ''}
<p><label><input type="checkbox" name="consent" value="true" required> Validate with one read-only balance request, store my key encrypted for this connection, and grant the permissions above. No automatic transaction retries.</label></p>
<button type="submit">Connect and authorize</button></form>
<p>Remove a connection with the connection-removal tool or revoke the client grant.</p>
</main></body></html>`;
}
