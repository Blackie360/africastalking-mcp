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

import {landingResponse} from '../dist/src/hosted/landing.js';
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

test('self-hosted links and copy configuration use the current origin without credentials or local commands',async()=>{
 const html=await landingResponse('https://custom.example',true,false).text();
 const config=JSON.parse(html.match(/id="remote-config"[^>]*>([^<]+)<\/textarea>/)[1].replaceAll('&quot;','"'));
 assert.deepEqual(config,{mcpServers:{africastalking:{url:'https://custom.example/mcp'}}});
 assert.doesNotMatch(html,/Claude|ChatGPT|Codex|guide-codex|guide-claude|guide-chatgpt/);
 assert.match(html,/Connect your account to Cursor/);
 assert.match(html,/data-copy-target="preview-prompt"/);assert.match(html,/dryRun:true/);
 assert.match(html,/href="https:\/\/cursor.com\/install-mcp/);
});

test('manual guide actions leave fallback panels visible',async()=>{
 const html=await landingResponse('https://mcp.example.test',true,true).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const {runInNewContext}=await import('node:vm');
 const fallback={hidden:false},otherGuide={hidden:false},target={hidden:true,querySelector:()=>({focus(){}}),scrollIntoView(){}};
 let click;
 const trigger={dataset:{guide:'cursor'},addEventListener:(_event,fn)=>{click=fn;}};
 const document={getElementById:id=>id==='guide-cursor'?target:{value:'https://mcp.example.test/mcp'},querySelectorAll:selector=>selector==='[data-guide]'?[trigger]:selector==='section.guide'?[otherGuide,target]:selector==='.guide'?[otherGuide,target,fallback]:[]};
 runInNewContext(script,{document,setTimeout,clearTimeout});click();
 assert.equal(fallback.hidden,false);assert.equal(otherGuide.hidden,true);assert.equal(target.hidden,false);
});
