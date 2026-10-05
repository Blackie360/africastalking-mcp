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
 assert.doesNotMatch(html,/Open web installer|Manual setup/);
});

test('Cursor install group has only the native Add to Cursor action',async()=>{
 const html=await landingResponse('https://mcp.example.test',true,true).text();
 const actions=html.match(/<div class="cursor-actions">([\s\S]*?)<\/div>/)[1];
 assert.equal((actions.match(/<(?:a|button)\b/g)||[]).length,1);
 assert.match(actions,/cursor:\/\/anysphere.cursor-deeplink\/mcp\/install/);
 assert.match(actions,/>Add to Cursor<\/a>/);
});

import {readFile} from 'node:fs/promises';
test('plugin marketplace resolves to a credential-free hosted package in both supported formats',async()=>{
 const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
 const market=await read('.agents/plugins/marketplace.json');
 const entry=market.plugins.find(p=>p.name==='africastalking');assert.ok(entry);
 const folder=entry.source.path.replace(/^\.\//,'');
 const portable=await read(folder+'/plugin.json');assert.equal(portable.name,entry.name);assert.deepEqual(await read('plugin.json'),portable);
 const remote=await read(folder+'/mcp.json');assert.equal(remote.mcpServers.africastalking.type,'streamable-http');assert.deepEqual(await read('mcp.json'),remote);
 const compat=await read(folder+'/.codex-plugin/plugin.json');
 // Required Codex presentation fields and limits from the official submission reference.
 for(const [key,max] of [['displayName',30],['shortDescription',30],['longDescription',4000],['developerName',80]])assert.ok(typeof compat.interface[key]==='string'&&compat.interface[key].length>0&&compat.interface[key].length<=max,key);
 for(const key of ['composerIcon','logo']){
  const path=compat.interface[key];assert.match(path,/^\.\/assets\/[^/]+\.svg$/);
  const icon=await readFile(new URL('../'+folder+'/'+path.slice(2),import.meta.url),'utf8');assert.match(icon,/viewBox="0 0 256 256"/);assert.ok(Buffer.byteLength(icon)<5*1024*1024);
 }

 const config=await read(folder+'/'+compat.mcpServers.replace(/^\.\//,''));
 assert.equal(config.mcpServers.africastalking.type,'http');
 for(const file of [remote,config]){assert.equal(file.mcpServers.africastalking.url,'https://at.blackielabs.com/mcp');assert.doesNotMatch(JSON.stringify(file),/command|apiKey|AT_API_KEY|Authorization|env/);}
});

test('SPA routes restore views, focus headings and recover unknown links without reading credentials',async()=>{
 const html=await landingResponse('https://mcp.example.test',true,true).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const {runInNewContext}=await import('node:vm');
 const views=['home','connect','how','security'].map(view=>({dataset:{view},hidden:false}));
 let focused=0,handler;
 const heading={setAttribute(){},focus(){focused++;}};
 const location={hash:'#/connect'};
 const document={title:'',getElementById:()=>({}),querySelectorAll:s=>s==='[data-view]'?views:[],querySelector:()=>heading};
 const history={replaceState(_state,_title,hash){location.hash=hash;}};
 const window={addEventListener(event,fn){assert.equal(event,'hashchange');handler=fn;},scrollTo(){}};
 runInNewContext(script,{document,location,history,window,setTimeout,clearTimeout});
 const active=()=>views.filter(v=>!v.hidden).map(v=>v.dataset.view);
 assert.deepEqual(active(),['connect']);assert.match(document.title,/Connect Cursor/);
 location.hash='#/how';handler();assert.deepEqual(active(),['how']);
 location.hash='#/connect';handler();assert.deepEqual(active(),['connect']);
 location.hash='#/unknown';handler();assert.deepEqual(active(),['home']);assert.equal(location.hash,'#/');
 assert.equal(focused,4);assert.doesNotMatch(script,/localStorage|sessionStorage|apiKey|access_token/);
});

test('self-hosted Geist assets load publicly with bounded routes and CSP',async()=>{
 const origin='https://mcp.example.test';const env={PUBLIC_ORIGIN:origin};
 for(const name of ['sans','mono','pixel-square']){
  const response=await worker.fetch(new Request(origin+'/fonts/geist-'+name+'-1.7.2.woff2'),env,{});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString(),'wOF2');
 }
 const page=await landingResponse(origin,true,true);assert.match(page.headers.get('content-security-policy'),/font-src 'self'/);
 const html=await page.text();assert.match(html,/font-display:swap/);assert.match(html,/Geist Sans/);assert.match(html,/Geist Mono/);
 assert.match(onboardingCsp(),/font-src 'self'/);
});
