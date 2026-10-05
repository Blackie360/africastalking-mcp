import { runInNewContext } from 'node:vm';
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
 assert.match(html,/choose Streamable HTTP and paste the copied URL/);
 assert.match(html,/data-copy-target="preview-prompt"/);assert.match(html,/dryRun:true/);
 assert.match(html,/href="https:\/\/cursor.com\/install-mcp/);
});

import { readFile } from 'node:fs/promises';
test('all clients have Add actions with guided remote handoffs and no fabricated install URLs',async()=>{
 const html=await landingResponse('https://custom.example',true,false).text();
 for(const client of ['Cursor','Claude','ChatGPT','Codex'])assert.match(html,new RegExp('Add to '+client));
 assert.match(html,/href="https:\/\/claude.ai\/customize\/connectors"[^>]+data-connect="claude"/);
 assert.match(html,/href="https:\/\/chatgpt.com\/plugins"[^>]+data-connect="chatgpt"/);
 assert.match(html,/type="button" data-connect="codex"/);
 assert.doesNotMatch(html,/codex:\/\/|claude:\/\/|chatgpt:\/\/|Set up Claude|Set up ChatGPT/);
 for(const id of ['claude','chatgpt','codex'])assert.match(html,new RegExp('id="url-'+id+'" readonly value="https://custom.example/mcp"'));
 assert.doesNotMatch(html,/id="guide-[^"]+" hidden/); // usable without JavaScript
});
test('plugin marketplace resolves to a credential-free hosted package in both supported formats',async()=>{
 const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
 const market=await read('.agents/plugins/marketplace.json');
 const entry=market.plugins.find(p=>p.name==='africastalking');assert.ok(entry);
 const folder=entry.source.path.replace(/^\.\//,'');
 const portable=await read(folder+'/plugin.json');assert.equal(portable.name,entry.name);assert.deepEqual(await read('plugin.json'),portable);
 const remote=await read(folder+'/mcp.json');assert.equal(remote.mcpServers.africastalking.type,'streamable-http');assert.deepEqual(await read('mcp.json'),remote);
 const compat=await read(folder+'/.codex-plugin/plugin.json');
 const config=await read(folder+'/'+compat.mcpServers.replace(/^\.\//,''));
 assert.equal(config.mcpServers.africastalking.type,'http');
 for(const file of [remote,config]){assert.equal(file.mcpServers.africastalking.url,'https://at.blackielabs.com/mcp');assert.doesNotMatch(JSON.stringify(file),/command|apiKey|AT_API_KEY|Authorization|env/);}
});

test('guided Add copies hosted URL and reveals steps; clipboard denial leaves a selectable fallback',async()=>{
 const html=await landingResponse('https://custom.example',true,false).text();
 const button={dataset:{connect:'chatgpt'},listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}};
 const endpoint={value:'https://custom.example/mcp',focus(){this.focused=true;},select(){this.selected=true;}};
 const feedback={textContent:''};const heading={focus(){this.focused=true;}};
 const guide={hidden:false,querySelector:()=>heading,scrollIntoView(){}};
 const document={getElementById:id=>({endpoint,feedback,'guide-chatgpt':guide})[id],querySelectorAll:selector=>selector==='section.guide'?[guide]:selector==='[data-connect]'?[button]:[]};
 const clipboard={async writeText(value){this.copied=value;}};
 runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document,navigator:{clipboard},setTimeout:()=>1,clearTimeout(){}});
 assert.equal(guide.hidden,true);button.listeners.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(guide.hidden,false);assert.equal(heading.focused,true);assert.equal(clipboard.copied,endpoint.value);
 clipboard.writeText=async()=>{throw new Error('denied');};button.listeners.click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(endpoint.focused,true);assert.equal(endpoint.selected,true);assert.match(feedback.textContent,/Select and copy/);
});

test('manual guide actions leave fallback panels visible',async()=>{
 const html=await landingResponse('https://mcp.example.test',true,true).text();
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const {runInNewContext}=await import('node:vm');
 const fallback={hidden:false},otherGuide={hidden:false},target={hidden:true,querySelector:()=>({focus(){}}),scrollIntoView(){}};
 let click;
 const trigger={dataset:{guide:'codex'},addEventListener:(_event,fn)=>{click=fn;}};
 const document={getElementById:id=>id==='guide-codex'?target:{value:'https://mcp.example.test/mcp'},querySelectorAll:selector=>selector==='[data-guide]'?[trigger]:selector==='section.guide'?[otherGuide,target]:selector==='.guide'?[otherGuide,target,fallback]:[]};
 runInNewContext(script,{document,setTimeout,clearTimeout});click();
 assert.equal(fallback.hidden,false);assert.equal(otherGuide.hidden,true);assert.equal(target.hidden,false);
});
