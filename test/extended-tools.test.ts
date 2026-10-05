import test from 'node:test';
import assert from 'node:assert/strict';
import { AfricaTalkingService } from '../src/service.js';
import { loadConfig } from '../src/config.js';
import { publicError } from '../src/errors.js';
import { operationUrl } from '../src/operations.js';

const phone = '+254700000000';
const bundle = { productName: 'TestProduct', recipients: [{phoneNumber:phone,quantity:50,unit:'MB',validity:'Day'}] };
const subscription = {shortCode:'46585',keyword:'TEST',phoneNumber:phone};
function make(environment:'sandbox'|'production', fetchFn:typeof fetch, settings:Record<string,string>={}) {
  return new AfricaTalkingService(loadConfig({AT_ENVIRONMENT:environment,AT_USERNAME:environment==='sandbox'?'sandbox':'live_app',AT_API_KEY:'synthetic-secret',AT_ENABLE_PRODUCTION:'true',AT_ALLOWED_RECIPIENTS:phone,...settings}),fetchFn);
}
for(const environment of ['sandbox','production'] as const) {
 test(`${environment}: additional reads use fixed origins, encode cursors, redact inbox and return safe pagination`,async()=>{
  const seen:URL[]=[];
  const service=make(environment,async(url,init)=>{
   const target=new URL(String(url));seen.push(target);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('apikey'),'synthetic-secret');
   if(target.pathname==='/version1/messaging') return Response.json({SMSMessageData:{Messages:[3,1,2].map(id=>({id,from:phone,to:'46585',date:'today',text:'PRIVATE synthetic-secret '+phone,linkId:'link'}))}});
   if(target.pathname==='/version1/subscription')return Response.json({responses:[{id:2,phoneNumber:phone,date:'today',rawPrivate:'must-not-return'}]});
   if(target.pathname==='/query/wallet/balance')return Response.json({status:'Success',balance:'KES 19',apiKey:'synthetic-secret'});
   return Response.json({status:'Success',data:{transactionId:'AT-1',status:'Success',destination:phone,productName:'TestProduct',value:'KES 20',providerMetadata:{recipientName:'PRIVATE_NAME'},requestMetadata:{secret:'synthetic-secret'}}});
  });
  const inbox=await service.inbox({lastReceivedId:0,limit:2});assert.deepEqual(inbox.messages.map(row=>row.id),[1,2]);assert.equal(inbox.nextCursor,2);assert.equal(inbox.hasMore,true);assert.doesNotMatch(JSON.stringify(inbox),/PRIVATE|synthetic-secret|\+254700000000/);
  const content=await service.inbox({includeMessageText:true});assert.match(JSON.stringify(content),/PRIVATE/);assert.doesNotMatch(JSON.stringify(content),/synthetic-secret|\+254700000000/);
  const subs=await service.subscriptions({shortCode:'46585',keyword:'TEST',lastReceivedId:1});assert.equal(subs.nextCursor,2);assert.doesNotMatch(JSON.stringify(subs),/rawPrivate|\+254700000000/);
  const wallet=await service.dataBalance();assert.equal(wallet.balance,'KES 19');assert.doesNotMatch(JSON.stringify(wallet),/synthetic-secret/);
  const transaction=await service.dataTransaction({transactionId:'AT-1'});assert.equal(transaction.transaction?.transactionId,'AT-1');assert.doesNotMatch(JSON.stringify(transaction),/PRIVATE_NAME|requestMetadata|synthetic-secret|\+254700000000/);
  assert.equal(seen[0]?.searchParams.get('lastReceivedId'),'0');assert.equal(seen[2]?.origin,environment==='sandbox'?'https://api.sandbox.africastalking.com':'https://content.africastalking.com');assert.equal(seen[3]?.origin,operationUrl('dataBalance',environment).origin);
 });
 test(`${environment}: subscription changes and mobile data use reviewed form/JSON contracts with no retries`,async()=>{
  const service=make(environment,async(url,init)=>{
   const target=new URL(String(url));assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');
   if(target.hostname.startsWith('bundles.')) {
    assert.equal(new Headers(init?.headers).get('Content-Type'),'application/json');assert.equal(target.pathname,'/mobile/data/request');
    const body=JSON.parse(String(init?.body));assert.equal(body.username,environment==='sandbox'?'sandbox':'live_app');assert.deepEqual(body.recipients,[{...bundle.recipients[0],metadata:{}}]);
    return Response.json({entries:[{phoneNumber:phone,status:'Queued',transactionId:'AT-1',provider:'Safaricom',value:'KES 20'}]});
   }
   assert.equal(new Headers(init?.headers).get('Content-Type'),'application/x-www-form-urlencoded');const form=new URLSearchParams(String(init?.body));assert.equal(form.get('phoneNumber'),phone);assert.equal(form.get('shortCode'),'46585');
   assert.equal(target.origin,environment==='sandbox'?'https://api.sandbox.africastalking.com':'https://content.africastalking.com');return Response.json({status:'Success'});
  },{AT_ENABLE_MUTATIONS:'true',AT_ENABLE_SUBSCRIPTIONS:'true',AT_ENABLE_DATA_MUTATIONS:'true'});
  assert.equal((await service.changeSubscription({...subscription,dryRun:false},false)).status,'accepted');assert.equal((await service.changeSubscription({...subscription,dryRun:false},true)).status,'accepted');
  const data=await service.dataSend({...bundle,dryRun:false});assert.equal(data.status,'accepted');assert.doesNotMatch(JSON.stringify(data),/\+254700000000/);
  await assert.rejects(service.dataSend({...bundle,dryRun:false}),/identical send/);
 });
}
test('new action previews need no credentials and make zero network calls; every actual action has independent opt-ins',async()=>{
 let calls=0;const offline=new AfricaTalkingService(loadConfig({}),async()=>{calls++;throw new Error('must not call');});
 assert.equal((await offline.dataSend(bundle)).sent,false);assert.equal((await offline.changeSubscription(subscription,false)).changed,false);assert.equal((await offline.changeSubscription(subscription,true)).changed,false);assert.equal(calls,0);
 const generic=make('sandbox',async()=>{calls++;return Response.json({});},{AT_ENABLE_MUTATIONS:'true'});
 await assert.rejects(generic.dataSend({...bundle,dryRun:false}),/explicit data-send/);await assert.rejects(generic.changeSubscription({...subscription,dryRun:false},false),/subscription permission/);assert.equal(calls,0);
 const togglesOnly=make('sandbox',async()=>{calls++;return Response.json({});},{AT_ENABLE_DATA_MUTATIONS:'true',AT_ENABLE_SUBSCRIPTIONS:'true'});
 await assert.rejects(togglesOnly.dataSend({...bundle,dryRun:false}),/AT_ENABLE_MUTATIONS/);assert.equal(calls,0);
});
test('production network gate applies to new reads; preview writes enforce recipient and volume limits',async()=>{
 let calls=0;const service=make('production',async()=>{calls++;return Response.json({});},{AT_ENABLE_PRODUCTION:'false'});
 await assert.rejects(service.dataBalance(),/Production network access/);await assert.rejects(service.inbox({}),/Production network access/);assert.equal(calls,0);
 await assert.rejects(service.dataSend({...bundle,recipients:[{...bundle.recipients[0],quantity:2,unit:'GB'}]}),/AT_MAX_DATA_MB_PER_REQUEST/);
 await assert.rejects(service.dataSend({...bundle,recipients:[{...bundle.recipients[0],phoneNumber:'+254700000001'}]}),/AT_ALLOWED_RECIPIENTS/);
 await assert.rejects(service.changeSubscription({...subscription,phoneNumber:'+254700000001'},true),/AT_ALLOWED_RECIPIENTS/);
});
test('ambiguous data failures retain duplicate reservations and never expose raw provider errors',async()=>{
 let calls=0;const service=make('sandbox',async()=>{calls++;throw new Error('synthetic-secret');},{AT_ENABLE_MUTATIONS:'true',AT_ENABLE_DATA_MUTATIONS:'true'});
 try {await service.dataSend({...bundle,dryRun:false});assert.fail('must fail');}catch(error){const output=publicError(error);assert.equal(output.outcomeUnknown,true);assert.doesNotMatch(JSON.stringify(output),/synthetic-secret/);}
 await assert.rejects(service.dataSend({...bundle,dryRun:false}),/identical send/);assert.equal(calls,1);
});
test('malformed and mismatched provider data fails closed, and partial data sends do not appear successful',async()=>{
 const mismatch=make('sandbox',async()=>Response.json({entries:[{phoneNumber:'+254700000001',status:'Queued',transactionId:'other'}]}),{AT_ENABLE_MUTATIONS:'true',AT_ENABLE_DATA_MUTATIONS:'true'});
 await assert.rejects(mismatch.dataSend({...bundle,dryRun:false}),error=>{assert.equal(publicError(error).outcomeUnknown,true);return true;});
 const tx=make('sandbox',async()=>Response.json({status:'Success',data:{transactionId:'wrong',destination:phone,productName:'TestProduct',value:'KES 20',status:'Success'}}));await assert.rejects(tx.dataTransaction({transactionId:'AT-1'}),/Unexpected/);
 const partial=make('sandbox',async()=>Response.json({entries:[{phoneNumber:phone,status:'Queued',transactionId:'AT-1'},{phoneNumber:'+254700000001',status:'Failed',transactionId:'AT-2'}]}),{AT_ENABLE_MUTATIONS:'true',AT_ENABLE_DATA_MUTATIONS:'true',AT_ALLOWED_RECIPIENTS:phone+',+254700000001'});
 assert.equal((await partial.dataSend({...bundle,recipients:[...bundle.recipients,{...bundle.recipients[0],phoneNumber:'+254700000001'}],dryRun:false})).status,'partial');
 const invalid=make('sandbox',async()=>Response.json({error:'raw-private'}));await assert.rejects(invalid.inbox({}),/Unexpected/);await assert.rejects(invalid.subscriptions({shortCode:'46585',keyword:'TEST'}),/Unexpected/);await assert.rejects(invalid.dataBalance(),/Unexpected/);
});
