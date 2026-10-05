import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CiphertextBackend, EncryptedRecord, HostedConfig, IdentityProvider, Principal, RateLimits, DedupeStore } from '../src/hosted/contracts.js';
import { credentialSchema, EncryptedCredentialStore, tenantId } from '../src/hosted/credentials.js';
import { createHostedHandler } from '../src/hosted/handler.js';
import { validAuthorization, createAuthorizationHandler } from '../src/hosted/authorize.js';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

const config: HostedConfig = { resource: 'https://mcp.example.test/mcp', authorizationServer: 'https://mcp.example.test', allowedOrigins: ['https://mcp.example.test'], productionEnabled: true };
const principal = (subject: string, scopes = ['mcp:use','sms:send','credentials:manage']): Principal => ({ subject, issuer: config.authorizationServer, audience: config.resource, scopes, expiresAt: Date.now()/1000+600 });
class Ciphertexts implements CiphertextBackend {
  records = new Map<string, EncryptedRecord>();
  async get(t: string) { return this.records.get(t) ?? null; }
  async put(t: string, r: EncryptedRecord) { this.records.set(t, r); }
  async delete(t: string) { this.records.delete(t); }
}
class Controls implements RateLimits, DedupeStore {
  reserved = new Set<string>(); denied = false;
  async consume() { return !this.denied; }
  async reserve(t: string, digest: string) { const k=t+digest; if(this.reserved.has(k)) return false; this.reserved.add(k); return true; }
}
function fixture() {
  const backend = new Ciphertexts();
  const keys = { activeKeyId: async () => 'test-only', encryptionKey: async () => new Uint8Array(32).fill(7) };
  const credentials = new EncryptedCredentialStore(backend, keys);
  const users: Record<string, Principal> = { alice: principal('alice'), bob: principal('bob') };
  const identity: IdentityProvider = { verifyAccessToken: async t => users[t] ?? null, browserSession: async () => null };
  const controls = new Controls();
  return { backend, keys, credentials, users, identity, controls };
}
const credential = (apiKey: string) => credentialSchema.parse({ apiKey, mutationsEnabled: true, allowedRecipients: ['+254700000000'] });
async function clientFor(handler: (r: Request) => Promise<Response>, token: string) {
  const client = new Client({ name: 'hosted-test', version: '1' }, { versionNegotiation: { mode: 'legacy' } });
  const transport = new StreamableHTTPClientTransport(new URL(config.resource), { requestInit: { headers: { Authorization: 'Bearer '+token } }, fetch: async (url, init) => handler(new Request(url, init)) });
  await client.connect(transport);
  return client;
}
const sms = { recipients: ['+254700000000'], message: 'Synthetic hosted test', dryRun: false };

test('AES-GCM ciphertext hides credentials; tenant swap and tamper fail closed', async () => {
  const f=fixture(), a=tenantId(f.users.alice!), b=tenantId(f.users.bob!);
  await f.credentials.put(a, credential('synthetic-a'));
  const envelope=f.backend.records.get(a)!;
  assert.doesNotMatch(JSON.stringify(envelope), /synthetic-a|254700000000/);
  assert.equal((await f.credentials.get(a))?.apiKey,'synthetic-a');
  f.backend.records.set(b,envelope);
  await assert.rejects(f.credentials.get(b));
  f.backend.records.set(a,{...envelope,tag:'AAAAAAAAAAAAAAAAAAAAAA=='});
  await assert.rejects(f.credentials.get(a));
});

test('same sandbox username does not merge tenants; actual HTTP MCP calls use isolated keys', async () => {
  const f=fixture();
  await f.credentials.put(tenantId(f.users.alice!),credential('synthetic-a'));
  await f.credentials.put(tenantId(f.users.bob!),credential('synthetic-b'));
  const seen:string[]=[];
  const handler=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls,providerFetch:async (url,init) => {
    assert.match(String(url),/^https:\/\/api.sandbox.africastalking.com\/version1\/user\?/);
    const key=new Headers(init?.headers).get('apikey')!; seen.push(key);
    return Response.json({UserData:{balance:key==='synthetic-a'?'KES 10':'KES 20'}});
  }});
  const [a,b]=await Promise.all([clientFor(handler,'alice'),clientFor(handler,'bob')]);
  try {
    const outputs=await Promise.all([a.callTool({name:'at_get_balance',arguments:{}}),b.callTool({name:'at_get_balance',arguments:{}})]);
    assert.deepEqual(outputs.map(o=>(o.structuredContent as Record<string, unknown>)?.balance),['KES 10','KES 20']);
    assert.deepEqual(seen.sort(),['synthetic-a','synthetic-b']);
    assert.doesNotMatch(JSON.stringify(outputs),/synthetic-a|synthetic-b/);
  } finally {await a.close();await b.close();}
});

test('durable reservation survives fresh per-request servers, including ambiguous failure', async () => {
  const f=fixture(); await f.credentials.put(tenantId(f.users.alice!),credential('synthetic-a'));
  let calls=0;
  const h=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls,providerFetch:async()=>{calls++;throw new Error('synthetic-a');}});
  const c=await clientFor(h,'alice');
  try {
    const first=await c.callTool({name:'at_send_sms',arguments:sms});
    const second=await c.callTool({name:'at_send_sms',arguments:sms});
    assert.match(JSON.stringify(first),/NETWORK_ERROR/);
    assert.match(JSON.stringify(second),/DUPLICATE_REQUEST/);
    assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(first),/synthetic-a/);
  }finally{await c.close();}
});

test('missing infrastructure, bad tokens, issuer/audience/expiry and origins fail closed', async()=>{
  assert.equal((await createHostedHandler(config,{})(new Request(config.resource))).status,503);
  const f=fixture();const h=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls});
  assert.equal((await h(new Request(config.resource))).status,401);
  assert.equal((await h(new Request(config.resource,{headers:{Authorization:'Bearer alice',Origin:'https://evil.test'}}))).status,403);
  for(const p of [{...principal('alice'),expiresAt:0},{...principal('alice'),audience:'https://other.test/mcp'},{...principal('alice'),issuer:'https://evil.test'}]){
    f.users.alice=p;
    assert.equal((await h(new Request(config.resource,{headers:{Authorization:'Bearer alice'}}))).status,401);
  }
});

test('scope, allowlist, caps, user production opt-in and tenant rate limits enforced',async()=>{
  const f=fixture();f.users.alice=principal('alice',['mcp:use']);
  await f.credentials.put(tenantId(f.users.alice!),credential('synthetic-a'));
  let calls=0;
  const h=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls,providerFetch:async()=>{calls++;throw new Error('must not call');}});
  const c=await clientFor(h,'alice');
  try{
    assert.match(JSON.stringify(await c.callTool({name:'at_send_sms',arguments:sms})),/SCOPE_REQUIRED/);
    assert.match(JSON.stringify(await c.callTool({name:'at_send_sms',arguments:{...sms,recipients:['+254700000001']}})),/RECIPIENT_NOT_ALLOWED/);
    assert.match(JSON.stringify(await c.callTool({name:'at_send_airtime',arguments:{recipients:[{phoneNumber:'+254700000000',amount:'101'}],currencyCode:'KES',dryRun:false}})),/AIRTIME_LIMIT/);
    assert.equal(calls,0);
  }finally{await c.close();}
  assert.equal(credentialSchema.safeParse({apiKey:'x',environment:'production',username:'app'}).success,false);
  f.controls.denied=true;
  assert.equal((await h(new Request(config.resource,{headers:{Authorization:'Bearer alice'}}))).status,429);
});

test('live mode uses only user production credential and explicit scope/recipient policy',async()=>{
  const f=fixture();f.users.alice=principal('alice',['mcp:use','sms:send','production:use']);
  await f.credentials.put(tenantId(f.users.alice!),credentialSchema.parse({apiKey:'synthetic-live',environment:'production',username:'live_app',productionOptIn:true,mutationsEnabled:true,allowedRecipients:sms.recipients}));
  let calls=0;
  const h=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls,providerFetch:async(url,init)=>{
    calls++;assert.equal(String(url),'https://api.africastalking.com/version1/messaging');
    assert.equal(new Headers(init?.headers).get('apikey'),'synthetic-live');
    return Response.json({SMSMessageData:{Recipients:[{number:sms.recipients[0],status:'Success',statusCode:101,messageId:'mock',cost:'KES 0.8'}]}});
  }});
  const c=await clientFor(h,'alice');try{
    const result=await c.callTool({name:'at_send_sms',arguments:sms});assert.equal((result.structuredContent as Record<string, unknown>)?.environment,'production');assert.equal(calls,1);
  }finally{await c.close();}
  const disabled=createHostedHandler({...config,productionEnabled:false},{...f,limits:f.controls,dedupe:f.controls});
  assert.equal((await disabled(new Request(config.resource,{method:'POST',headers:{Authorization:'Bearer alice'}}))).status,403);
});

test('PKCE S256 and exact resource required before credential login',()=>{
  const a:AuthRequest={responseType:'code',clientId:'client',redirectUri:'https://client.test/callback',scope:['mcp:use'],state:'test-state',codeChallenge:'A'.repeat(43),codeChallengeMethod:'S256',resource:config.resource};
  assert.equal(validAuthorization(a,config),true);
  for(const delta of [{codeChallengeMethod:'plain'},{codeChallenge:''},{resource:'https://other.test'},{scope:['unknown']}]) assert.equal(validAuthorization({...a,...delta},config),false);
});

test('onboarding denies cross-origin form before reading credentials or calling provider',async()=>{
  const f=fixture();let called=false;
  const oauth={approveConsent:async()=>{called=true;throw new Error('never');}} as unknown as OAuthHelpers;
  const h=createAuthorizationHandler(config,{oauth,credentials:f.credentials,limits:f.controls,replay:f.controls});
  const r=await h(new Request('https://mcp.example.test/authorize',{method:'POST',headers:{Origin:'https://evil.test'},body:'apiKey=synthetic'}));
  assert.equal(r.status,403);assert.equal(called,false);assert.doesNotMatch(await r.text(),/synthetic/);
});

test('connection deletion is tenant-scoped and immediately blocks retained tokens',async()=>{
  const f=fixture();for(const name of ['alice','bob'])await f.credentials.put(tenantId(f.users[name]!),credential('synthetic-'+name));
  const h=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls});const c=await clientFor(h,'alice');
  try{assert.equal(((await c.callTool({name:'at_disconnect',arguments:{confirm:true}})).structuredContent as Record<string, unknown>)?.disconnected,true);}finally{await c.close();}
  assert.equal(await f.credentials.get(tenantId(f.users.alice!)),null);
  assert.ok(await f.credentials.get(tenantId(f.users.bob!)));
  assert.equal((await h(new Request(config.resource,{method:'POST',headers:{Authorization:'Bearer alice'}}))).status,403);
});

test('consent choices grant precise scopes, validate by GET and create isolated connections; replay never validates twice',async()=>{
  const f=fixture();const completed: Array<{userId:string;scope:string[]}> = [];let reads=0;
  const base:AuthRequest={responseType:'code',clientId:'client',redirectUri:'https://client.test/callback',scope:['mcp:use'],state:'test',codeChallenge:'A'.repeat(43),codeChallengeMethod:'S256',resource:config.resource};
  const oauth={
    approveConsent:async(_r:Request,_h:string,options:{scope:string[]})=>({request:{...base,scope:options.scope},headers:new Headers()}),
    completeAuthorization:async(input:{userId:string;scope:string[]})=>{completed.push(input);return {redirectTo:'https://client.test/callback?code=synthetic'};},
  } as unknown as OAuthHelpers;
  const h=createAuthorizationHandler(config,{oauth,credentials:f.credentials,limits:f.controls,replay:f.controls,providerFetch:async(url,init)=>{
    reads++;assert.equal(init?.method,'GET');assert.match(String(url),/\/version1\/user\?/);return Response.json({UserData:{balance:'KES 1'}});
  }});
  const submit=(handle:string,live=false)=>h(new Request('https://mcp.example.test/authorize',{method:'POST',headers:{Origin:config.authorizationServer},body:new URLSearchParams({handle,consent:'true',apiKey:'synthetic',environment:live?'production':'sandbox',username:live?'live_app':'sandbox',...(live?{mutationsEnabled:'true',productionOptIn:'true',allowedRecipients:'+254700000000'}:{})})}));
  assert.equal((await submit('first')).status,303);assert.deepEqual(completed[0]?.scope,['mcp:use','credentials:manage']);
  assert.equal((await submit('first')).status,400);assert.equal(reads,1);
  assert.equal((await submit('second')).status,303);assert.notEqual(completed[0]?.userId,completed[1]?.userId);
  assert.equal((await submit('live',true)).status,303);assert.deepEqual(completed[2]?.scope,['mcp:use','credentials:manage','sms:send','airtime:send','production:use']);
  assert.equal(f.backend.records.size,3);assert.equal(reads,3);assert.doesNotMatch(JSON.stringify([...f.backend.records]),/synthetic|live_app/);
});

test('new hosted scopes and stored opt-ins isolate reads/writes from existing SMS consent',async()=>{
 const f=fixture();let calls=0;
 await f.credentials.put(tenantId(f.users.alice!),credential('synthetic-a'));
 const h=createHostedHandler(config,{...f,limits:f.controls,dedupe:f.controls,providerFetch:async(url,init)=>{
  calls++;assert.equal(new Headers(init?.headers).get('apikey'),'synthetic-a');
  if(String(url).includes('/messaging'))return Response.json({SMSMessageData:{Messages:[]}});
  if(String(url).includes('/subscription/create'))return Response.json({status:'Success'});
  if(init?.method==='POST')return Response.json({entries:[{phoneNumber:'+254700000000',status:'Queued',transactionId:'AT-1'}]});
  return Response.json({status:'Success',balance:'KES 1'});
 }});
 const data={productName:'TestProduct',recipients:[{phoneNumber:'+254700000000',quantity:50,unit:'MB',validity:'Day'}],dryRun:false};
 const call=async(name:string,args:Record<string,unknown>)=>{const c=await clientFor(h,'alice');try{return await c.callTool({name,arguments:args});}finally{await c.close();}};
 assert.match(JSON.stringify(await call('at_fetch_sms',{})),/SCOPE_REQUIRED/);
 assert.match(JSON.stringify(await call('at_get_data_balance',{})),/SCOPE_REQUIRED/);
 assert.match(JSON.stringify(await call('at_send_mobile_data',data)),/DATA_SEND_DISABLED/);assert.equal(calls,0);
 f.users.alice={...f.users.alice!,scopes:['mcp:use','sms:read','data:read','data:send','subscriptions:manage']};
 assert.equal((await call('at_fetch_sms',{})).isError,undefined);assert.equal((await call('at_get_data_balance',{})).isError,undefined);assert.equal(calls,2);
 // Old ciphertext defaults new flags to false even if a token has additional scopes.
 assert.match(JSON.stringify(await call('at_send_mobile_data',data)),/DATA_SEND_DISABLED/);assert.equal(calls,2);
 await f.credentials.put(tenantId(f.users.alice!),credentialSchema.parse({apiKey:'synthetic-a',dataMutationsEnabled:true,subscriptionsEnabled:true,mutationsEnabled:false,allowedRecipients:['+254700000000']}));
 assert.equal((await call('at_send_mobile_data',data)).isError,undefined);assert.equal(calls,3);
 assert.match(JSON.stringify(await call('at_send_mobile_data',data)),/DUPLICATE_REQUEST/);assert.equal(calls,3);
 assert.equal((await call('at_create_subscription',{shortCode:'46585',keyword:'TEST',phoneNumber:'+254700000000',dryRun:false})).isError,undefined);assert.equal(calls,4);
 // Enabling data must never enable SMS when its stored permission is off.
 f.users.alice={...f.users.alice!,scopes:[...f.users.alice!.scopes,'sms:send']};
 assert.match(JSON.stringify(await call('at_send_sms',sms)),/MUTATIONS_DISABLED/);assert.equal(calls,4);
});

test('additional consent grants only checked new scopes; API key validation remains a single balance read',async()=>{
 const f=fixture();let granted:string[]=[];let reads=0;
 const base:AuthRequest={responseType:'code',clientId:'client',redirectUri:'https://client.test/callback',scope:['mcp:use'],state:'test',codeChallenge:'A'.repeat(43),codeChallengeMethod:'S256',resource:config.resource};
 const oauth={approveConsent:async(_r:Request,_h:string,options:{scope:string[]})=>{granted=options.scope;return {request:{...base,scope:options.scope},headers:new Headers()};},completeAuthorization:async()=>({redirectTo:'https://client.test/callback?code=synthetic'})} as unknown as OAuthHelpers;
 const h=createAuthorizationHandler(config,{oauth,credentials:f.credentials,limits:f.controls,replay:f.controls,providerFetch:async(url,init)=>{reads++;assert.match(String(url),/\/version1\/user\?/);assert.equal(init?.method,'GET');return Response.json({UserData:{balance:'KES 1'}});}});
 const r=await h(new Request(config.authorizationServer+'/authorize',{method:'POST',headers:{Origin:config.authorizationServer},body:new URLSearchParams({handle:'new-services',consent:'true',apiKey:'synthetic',smsReadsEnabled:'true',dataMutationsEnabled:'true',subscriptionsEnabled:'true'})}));
 assert.equal(r.status,303);assert.deepEqual(granted,['mcp:use','credentials:manage','sms:read','data:send','subscriptions:manage']);assert.equal(reads,1);
 const tenant=[...f.backend.records.keys()][0]!;const saved=await f.credentials.get(tenant);assert.equal(saved?.dataMutationsEnabled,true);assert.equal(saved?.subscriptionsEnabled,true);assert.equal(saved?.mutationsEnabled,false);
});
