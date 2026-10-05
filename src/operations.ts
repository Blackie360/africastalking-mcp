import type { Config } from './config.js';
/** Provider destinations and permissions are fixed, never supplied by a tool caller. */
export const OPERATIONS = {
  '/user': { host: 'api', path: '/version1/user', method: 'GET', encoding: 'form', mutation: false, scope: 'mcp:use' },
  '/messaging': { host: 'api', path: '/version1/messaging', method: 'POST', encoding: 'form', mutation: true, scope: 'sms:send' },
  '/airtime/send': { host: 'api', path: '/version1/airtime/send', method: 'POST', encoding: 'form', mutation: true, scope: 'airtime:send' },
  inbox: { host: 'api', path: '/version1/messaging', method: 'GET', encoding: 'form', mutation: false, scope: 'sms:read' },
  subscriptions: { host: 'content', path: '/version1/subscription', method: 'GET', encoding: 'form', mutation: false, scope: 'sms:read' },
  subscribe: { host: 'content', path: '/version1/subscription/create', method: 'POST', encoding: 'form', mutation: true, scope: 'subscriptions:manage' },
  unsubscribe: { host: 'content', path: '/version1/subscription/delete', method: 'POST', encoding: 'form', mutation: true, scope: 'subscriptions:manage' },
  dataBalance: { host: 'bundles', path: '/query/wallet/balance', method: 'GET', encoding: 'json', mutation: false, scope: 'data:read' },
  dataTransaction: { host: 'bundles', path: '/query/transaction/find', method: 'GET', encoding: 'json', mutation: false, scope: 'data:read' },
  dataSend: { host: 'bundles', path: '/mobile/data/request', method: 'POST', encoding: 'json', mutation: true, scope: 'data:send' },
} as const;
export type Operation = keyof typeof OPERATIONS;
export function operationUrl(operation: Operation, environment: Config['environment']): URL {
  const spec = OPERATIONS[operation];
  // Premium content shares the API hostname in sandbox, but has its own live origin.
  const host = spec.host === 'content' && environment === 'sandbox' ? 'api' : spec.host;
  return new URL(`https://${host}.${environment === 'sandbox' ? 'sandbox.' : ''}africastalking.com${spec.path}`);
}
