// Test-only host shim. OAuth library code remains real; no Worker runtime claim.
export async function resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true};
 return next(specifier,context);
}
