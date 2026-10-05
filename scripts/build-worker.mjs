import { build } from 'esbuild';
await build({entryPoints:['src/hosted/worker.ts'],bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker'],external:['cloudflare:workers','node:*'],outfile:'build/worker.mjs',logLevel:'info'});
