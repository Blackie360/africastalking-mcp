import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Controls, D1Ciphertexts, type Database } from '../src/hosted/d1.js';

test('real SQLite atomic reservations and counters isolate tenants and retain ambiguous attempts',async()=>{
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/0001_hosted.sql',import.meta.url),'utf8'));
  const db:Database={prepare:query=>({bind:(...values)=>({first:async<T>()=>(sql.prepare(query).get(...values) as T|undefined)??null,run:async()=>sql.prepare(query).run(...values)})})};
  let now=1000000;const a=new D1Controls(db,()=>now),b=new D1Controls(db,()=>now);
  assert.deepEqual(await Promise.all([a.reserve('alice','same',300),b.reserve('alice','same',300)]),[true,false]);
  assert.equal(await b.reserve('bob','same',300),true);
  assert.deepEqual(await Promise.all([a.consume('alice','send',2,60),b.consume('alice','send',2,60),b.consume('alice','send',2,60)]),[true,true,false]);
  assert.equal(await b.consume('bob','send',2,60),true);
  now+=301000;
  assert.equal(await b.reserve('alice','same',300),true);
  assert.equal(await a.consume('alice','send',2,60),true);
  const records=new D1Ciphertexts(db);
  const envelope={version:1 as const,keyId:'mock',nonce:'mock',ciphertext:'encrypted-only',tag:'mock'};
  await records.put('alice',envelope);assert.deepEqual(await records.get('alice'),envelope);assert.equal(await records.get('bob'),null);
  await records.delete('alice');assert.equal(await records.get('alice'),null);
  sql.close();
});
