import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import OAuthProvider, { getOAuthApi } from '@cloudflare/workers-oauth-provider';
class MockKV {
 data=new Map();
 async get(k,type){const v=this.data.get(k);if(!v)return null;return (type==='json'||type?.type==='json')?JSON.parse(v.value):v.value;}
 async put(k,value,options){this.data.set(k,{value,metadata:options?.metadata});}
 async delete(k){this.data.delete(k);}
 async list({prefix='' }={}){return {keys:[...this.data].filter(([k])=>k.startsWith(prefix)).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true,cursor:''};}
 async getWithMetadata(k,type){return {value:await this.get(k,type),metadata:this.data.get(k)?.metadata??null};}
}
const base='https://mcp.example.test';
const options={apiRoute:'/mcp',apiHandler:{fetch:(_r,_e,ctx)=>Response.json({subject:ctx.props.subject,scope:ctx.auth.scope})},defaultHandler:{fetch:()=>new Response('authorization UI')},authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',resourceMetadata:{resource:base+'/mcp',authorization_servers:[base]},requiredScopes:['mcp:use'],scopesSupported:['mcp:use'],accessTokenTTL:600,refreshTokenTTL:3600};
const ctx={waitUntil(){},passThroughOnException(){}};

test('real OAuth library validates redirect, binds consent cookie, verifies PKCE, rejects code replay and revokes token',async()=>{
 const env={OAUTH_KV:new MockKV()};const provider=new OAuthProvider(options);const api=getOAuthApi(options,env);
 const client=await api.createClient({clientName:'Test client',redirectUris:['https://client.example.test/callback'],tokenEndpointAuthMethod:'none',grantTypes:['authorization_code','refresh_token'],responseTypes:['code']});
 const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
 const params=new URLSearchParams({client_id:client.clientId,redirect_uri:'https://client.example.test/callback',response_type:'code',scope:'mcp:use',state:'test-state',code_challenge:challenge,code_challenge_method:'S256',resource:base+'/mcp'});
 const auth=await api.parseAuthRequest(new Request(base+'/authorize?'+params));
 const bad=new URLSearchParams(params);bad.set('redirect_uri','https://evil.example.test');await assert.rejects(api.parseAuthRequest(new Request(base+'/authorize?'+bad)));
 const consent=await api.beginConsent(auth);
 await assert.rejects(api.approveConsent(new Request(base+'/authorize',{method:'POST'}),consent.handle));
 const cookie=consent.headers.get('set-cookie').split(';')[0];
 const approved=await api.approveConsent(new Request(base+'/authorize',{method:'POST',headers:{Cookie:cookie}}),consent.handle);
 await assert.rejects(api.approveConsent(new Request(base+'/authorize',{method:'POST',headers:{Cookie:cookie}}),consent.handle));
 const complete=await api.completeAuthorization({request:approved.request,userId:'opaque-test-connection',metadata:{environment:'sandbox'},scope:['mcp:use'],props:{subject:'opaque-test-connection'}});
 const code=new URL(complete.redirectTo).searchParams.get('code');assert.ok(code);
 const tokenBody=new URLSearchParams({grant_type:'authorization_code',client_id:client.clientId,code,code_verifier:verifier,redirect_uri:'https://client.example.test/callback',resource:base+'/mcp'});
 const wrong=new URLSearchParams(tokenBody);wrong.set('code_verifier','w'.repeat(43));
 const badResponse=await provider.fetch(new Request(base+'/oauth/token',{method:'POST',body:wrong}),env,ctx);assert.equal(badResponse.status,400);
 // Some providers consume invalid exchanges. Authorize a fresh code for the successful path.
 const complete2=await api.completeAuthorization({request:auth,userId:'opaque-test-connection',metadata:{environment:'sandbox'},scope:['mcp:use'],props:{subject:'opaque-test-connection'}});
 tokenBody.set('code',new URL(complete2.redirectTo).searchParams.get('code'));
 const response=await provider.fetch(new Request(base+'/oauth/token',{method:'POST',body:tokenBody}),env,ctx);assert.equal(response.status,200);
 const tokens=await response.json();assert.ok(tokens.access_token);assert.doesNotMatch(JSON.stringify(tokens),/apiKey|synthetic-provider-key/);
 const allowed=await provider.fetch(new Request(base+'/mcp',{headers:{Authorization:'Bearer '+tokens.access_token}}),env,ctx);assert.equal(allowed.status,200);assert.equal((await allowed.json()).subject,'opaque-test-connection');
 const grants=await api.listUserGrants('opaque-test-connection');
 for(const grant of grants.items)await api.revokeGrant(grant.id,'opaque-test-connection');
 const replay=await provider.fetch(new Request(base+'/oauth/token',{method:'POST',body:tokenBody}),env,ctx);assert.equal(replay.status,400);
 const revoked=await provider.fetch(new Request(base+'/mcp',{headers:{Authorization:'Bearer '+tokens.access_token}}),env,ctx);assert.equal(revoked.status,401);
});
