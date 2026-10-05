import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../dist/src/hosted/worker.js';
test('public landing is available without credentials; protected routes stay fail-closed and install link contains only endpoint',async()=>{
 const origin='https://at.blackielabs.com';const env={PUBLIC_ORIGIN:origin};
 const r=await worker.fetch(new Request(origin),env,{});assert.equal(r.status,200);const html=await r.text();
 assert.match(html,/Setup in progress/);assert.match(html,/Add to Cursor/);
 const url=new URL(html.match(/href="(cursor:\/\/anysphere.cursor-deeplink\/mcp\/install[^"]+)"/)[1].replaceAll('&amp;','&'));
 assert.deepEqual(JSON.parse(Buffer.from(url.searchParams.get('config'),'base64').toString()),{url:origin+'/mcp'});
 for(const [tag,type] of [['script','script-src'],['style','style-src']]){
  const body=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1];
  assert.ok(r.headers.get('content-security-policy').includes(type+" 'sha256-"+createHash('sha256').update(body).digest('base64')+"'"));
 }
 for(const path of ['/mcp','/authorize','/oauth/token'])assert.equal((await worker.fetch(new Request(origin+path),env,{})).status,503);
 assert.equal((await worker.fetch(new Request('https://other.example/'),env,{})).status,400);
 assert.equal(r.headers.get('cache-control'),'no-store');
});

import { onboardingPage, onboardingCsp } from '../dist/src/hosted/onboarding.js';
import { landingResponse } from '../dist/src/hosted/landing.js';
import { runInNewContext } from 'node:vm';
test('hosted onboarding switches sandbox/live requirements without enabling sends and CSP permits only its scripts',()=>{
 const description={clientName:'<untrusted>',clientDomain:'client.example',redirectHost:'client.example',redirectIsLoopback:false,scope:['mcp:use']};
 const html=onboardingPage('opaque-handle',description,true);
 assert.match(html,/&lt;untrusted&gt;/);assert.doesNotMatch(html,/<untrusted>/);
 assert.match(html,/type="password" name="apiKey"/);assert.doesNotMatch(html,/name="(?:mutationsEnabled|productionOptIn)"[^>]*checked/);
 for(const [tag,type] of [['script','script-src'],['style','style-src']]){
  const body=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1];
  assert.ok(onboardingCsp().includes(type+" 'sha256-"+createHash('sha256').update(body).digest('base64')+"'"));
 }
 const elements={environment:{value:'sandbox',addEventListener(_event,fn){this.change=fn;}},username:{value:'sandbox'},allowedRecipients:{value:''},productionOptIn:{checked:false}};
 const liveFields={},hint={};const form={elements,addEventListener(){}};
 runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document:{querySelector:()=>form,getElementById:id=>id==='live-fields'?liveFields:hint}});
 assert.equal(liveFields.hidden,true);assert.equal(elements.username.readOnly,true);assert.equal(elements.productionOptIn.required,false);
 elements.environment.value='production';elements.environment.change();
 assert.equal(liveFields.hidden,false);assert.equal(elements.username.value,'');assert.equal(elements.username.readOnly,false);
 assert.equal(elements.allowedRecipients.required,true);assert.equal(elements.productionOptIn.required,true);assert.equal(elements.productionOptIn.checked,false);
 elements.username.value='live_app';elements.productionOptIn.checked=true;
 elements.environment.value='sandbox';elements.environment.change();
 assert.equal(elements.username.value,'sandbox');assert.equal(elements.productionOptIn.checked,false);assert.equal(elements.allowedRecipients.required,false);
 assert.doesNotMatch(onboardingPage('handle',description,false),/<option value="production">/);
});

test('self-hosted links and copy configuration use the current origin without credentials or local commands',async()=>{
 const html=await landingResponse('https://custom.example',true,false).text();
 const config=JSON.parse(html.match(/id="remote-config"[^>]*>([^<]+)<\/textarea>/)[1].replaceAll('&quot;','"'));
 assert.deepEqual(config,{mcpServers:{africastalking:{url:'https://custom.example/mcp'}}});
 assert.match(html,/codex mcp add africastalking --url https:\/\/custom.example\/mcp/);
 assert.match(html,/data-copy-target="preview-prompt"/);assert.match(html,/dryRun:true/);
 assert.match(html,/href="https:\/\/cursor.com\/install-mcp/);
});
