import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../dist/src/hosted/worker.js';
test('public landing is available without credentials; protected routes stay fail-closed and install link contains only endpoint',async()=>{
 const origin='https://at.blackielabs.com';const env={PUBLIC_ORIGIN:origin};
 const r=await worker.fetch(new Request(origin),env,{});assert.equal(r.status,200);const html=await r.text();
 assert.match(html,/Setup in progress/);assert.match(html,/Add to Cursor/);
 const url=new URL(html.match(/href="(https:\/\/cursor.com\/install-mcp[^"]+)"/)[1].replaceAll('&amp;','&'));
 assert.deepEqual(JSON.parse(Buffer.from(url.searchParams.get('config'),'base64').toString()),{url:origin+'/mcp'});
 for(const [tag,type] of [['script','script-src'],['style','style-src']]){
  const body=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1];
  assert.ok(r.headers.get('content-security-policy').includes(type+" 'sha256-"+createHash('sha256').update(body).digest('base64')+"'"));
 }
 for(const path of ['/mcp','/authorize','/oauth/token'])assert.equal((await worker.fetch(new Request(origin+path),env,{})).status,503);
 assert.equal((await worker.fetch(new Request('https://other.example/'),env,{})).status,400);
 assert.equal(r.headers.get('cache-control'),'no-store');
});

import {onboardingPage,onboardingCsp,onboardingErrorResponse} from '../dist/src/hosted/onboarding.js';
test('authorization page escapes client data, starts with sends off, and error recovery never repeats credentials',async()=>{
 const description={clientName:'<unsafe>',clientDomain:'client.example',redirectHost:'localhost:3000',redirectIsLoopback:true,scope:['mcp:use']};
 const html=onboardingPage('opaque-test-handle',description,true);
 assert.match(html,/&lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>/);
 assert.match(html,/type="password" name="apiKey"/);assert.doesNotMatch(html,/name="(?:mutationsEnabled|productionOptIn)"[^>]*checked/);
 assert.match(html,/method="post" action="\/authorize"/);
 for(const [tag,type] of [['script','script-src'],['style','style-src']]){
  const body=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1];assert.ok(onboardingCsp().includes(type+" 'sha256-"+createHash('sha256').update(body).digest('base64')+"'"));
 }
 assert.doesNotMatch(onboardingPage('handle',description,false),/<option value="production">/);
 const error=onboardingErrorResponse('consent_expired_or_used',400);assert.equal(error.status,400);assert.equal(error.headers.get('cache-control'),'no-store');
 const text=await error.text();assert.match(text,/Authenticate/);assert.doesNotMatch(text,/opaque-test-handle|<form|apiKey=/);
});
