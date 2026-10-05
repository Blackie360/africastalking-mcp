#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { publicError } from './errors.js';
import { createServer } from './server.js';

try {
  const config = loadConfig();
  const handle = serveStdio(() => createServer(config));
  const stop = () => { void handle.close().finally(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  // stdout belongs exclusively to the MCP transport.
  process.stderr.write(`${JSON.stringify(publicError(error))}\n`);
  process.exitCode = 1;
}
