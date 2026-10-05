import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

const sms = { recipients: ['+254700000000'], message: 'Hello from the offline test' };
for (const mode of ['legacy', 'auto'] as const) {
  test(`real stdio process: ${mode} handshake, tools/list, safe calls and shutdown`, { timeout: 15000 }, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
      env: { AT_ENVIRONMENT: 'sandbox', AT_USERNAME: 'sandbox', AT_API_KEY: '', AT_ENABLE_MUTATIONS: 'false', AT_ENABLE_PRODUCTION: 'false' },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const client = new Client({ name: 'offline-smoke-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    try {
      await client.connect(transport);
      const list = await client.listTools();
      assert.deepEqual(list.tools.map(tool => tool.name).sort(), ['at_get_balance', 'at_get_config', 'at_send_airtime', 'at_send_sms']);
      const config = await client.callTool({ name: 'at_get_config', arguments: {} });
      assert.equal((config.structuredContent as Record<string, unknown>)?.defaultDryRun, true);
      const preview = await client.callTool({ name: 'at_send_sms', arguments: sms });
      assert.equal((preview.structuredContent as Record<string, unknown>)?.sent, false);
      assert.equal((preview.structuredContent as Record<string, unknown>)?.dryRun, true);
      const blocked = await client.callTool({ name: 'at_send_sms', arguments: { ...sms, dryRun: false } });
      assert.equal(blocked.isError, true);
      assert.match(JSON.stringify(blocked), /MUTATIONS_DISABLED/);
      const balance = await client.callTool({ name: 'at_get_balance', arguments: {} });
      assert.equal(balance.isError, true);
      assert.match(JSON.stringify(balance), /MISSING_CREDENTIALS/);
      const invalid = await client.callTool({ name: 'at_send_sms', arguments: { ...sms, recipients: ['not-a-phone'] } });
      assert.equal(invalid.isError, true);
    } finally {
      await client.close();
      assert.equal(stderr, '', 'No diagnostics or credentials should leak to stderr');
    }
  });
}

test('mocked provider through MCP exposes acceptance and partial errors without leaking phone numbers', async () => {
  let requests = 0;
  const fetchFn: typeof fetch = async () => {
    requests++;
    return Response.json({ SMSMessageData: { Recipients: [
      { number: '+254700000000', status: 'Success', statusCode: 101, messageId: 'AT-1', cost: 'KES 1' },
      { number: '+254700000001', status: 'InvalidPhoneNumber', statusCode: 403, messageId: '', cost: 'KES 0' },
    ] } }, { status: 201 });
  };
  const server = createServer(loadConfig({ AT_ENABLE_MUTATIONS: 'true', AT_API_KEY: 'unit-test-placeholder' }), fetchFn);
  const client = new Client({ name: 'mock-client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b, { prior: { kind: 'legacy' } });
  try {
    const output = await client.callTool({ name: 'at_send_sms', arguments: { ...sms, recipients: ['+254700000000', '+254700000001'], dryRun: false } });
    assert.equal(output.isError, true);
    assert.equal((output.structuredContent as Record<string, unknown>)?.status, 'partial');
    assert.equal(requests, 1);
    assert.doesNotMatch(JSON.stringify(output), /\+25470000000/);
  } finally { await client.close(); await server.close(); }
});
