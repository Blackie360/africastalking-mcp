import { createServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleUssd } from './ussd-handler.js';

const MAX_BYTES = 8192;
async function parseForm(request: IncomingMessage): Promise<Record<string, string>> {
  const parts = await new Promise<Buffer[]>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };
    const onError = () => { cleanup(); reject(new Error('Invalid request')); };
    const onEnd = () => { cleanup(); resolve(chunks); };
    const onData = (data: Buffer) => {
      size += data.length;
      if (size > MAX_BYTES) {
        cleanup();
        request.resume();
        reject(new Error('Body too large'));
      } else { chunks.push(data); }
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
  });
  const form = new URLSearchParams(Buffer.concat(parts).toString('utf8'));
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of form) {
    if (Object.hasOwn(fields, key)) throw new Error('Duplicate field');
    fields[key] = value;
  }
  return fields;
}
export function createUssdServer() {
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST' || request.url !== '/ussd') {
      response.writeHead(404).end('Not found');
      return;
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      response.writeHead(415).end('END Unsupported content type.');
      return;
    }
    try { const fields = await parseForm(request); response.writeHead(200).end(handleUssd(fields)); }
    catch { response.writeHead(400).end('END Invalid request.'); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.timeout = 10000;
  server.maxHeadersCount = 30;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.USSD_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid USSD_PORT');
  const server = createUssdServer();
  // Loopback only: public hosting/authentication is deliberately out of scope.
  server.listen(port, '127.0.0.1', () => process.stderr.write(`USSD demo: http://127.0.0.1:${port}/ussd\n`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
