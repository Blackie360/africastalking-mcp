import type { CiphertextBackend, DedupeStore, EncryptedRecord, KeyManagement, RateLimits } from './contracts.js';
export interface Database {
  prepare(sql: string): { bind(...values: (string | number)[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } };
}
export class D1Ciphertexts implements CiphertextBackend {
  constructor(private readonly db: Database) {}
  async get(tenant: string): Promise<EncryptedRecord | null> {
    const row = await this.db.prepare('SELECT envelope FROM credentials WHERE tenant = ?').bind(tenant).first<{ envelope: string }>();
    return row ? JSON.parse(row.envelope) as EncryptedRecord : null;
  }
  async put(tenant: string, record: EncryptedRecord): Promise<void> {
    await this.db.prepare('INSERT INTO credentials(tenant, envelope) VALUES (?, ?) ON CONFLICT(tenant) DO UPDATE SET envelope=excluded.envelope').bind(tenant, JSON.stringify(record)).run();
  }
  async delete(tenant: string): Promise<void> { await this.db.prepare('DELETE FROM credentials WHERE tenant = ?').bind(tenant).run(); }
}
export class D1Controls implements RateLimits, DedupeStore {
  constructor(private readonly db: Database, private readonly now = () => Date.now()) {}
  async consume(tenant: string, bucket: 'request' | 'send' | 'credential', limit: number, seconds: number): Promise<boolean> {
    const window = Math.floor(this.now() / 1000 / seconds);
    return null !== await this.db.prepare(`INSERT INTO rate_limits(tenant,bucket,window,count) VALUES(?,?,?,1)
      ON CONFLICT(tenant,bucket) DO UPDATE SET window=excluded.window, count=CASE WHEN rate_limits.window=excluded.window THEN rate_limits.count+1 ELSE 1 END
      WHERE rate_limits.window<>excluded.window OR rate_limits.count<? RETURNING count`).bind(tenant, bucket, window, limit).first();
  }
  async reserve(tenant: string, digest: string, seconds: number): Promise<boolean> {
    const now = Math.floor(this.now()/1000);
    return null !== await this.db.prepare(`INSERT INTO reservations(tenant,digest,expires_at) VALUES(?,?,?)
      ON CONFLICT(tenant,digest) DO UPDATE SET expires_at=excluded.expires_at
      WHERE reservations.expires_at<=? RETURNING expires_at`).bind(tenant, digest, now+seconds, now).first();
  }
}
/** Deployment secret only; no generated fallback. Return independent wipeable buffers. */
export class DeploymentKeyManagement implements KeyManagement {
  constructor(private readonly id: string, private readonly encodedKey: string) {}
  async activeKeyId(): Promise<string> { return this.id; }
  async encryptionKey(id: string): Promise<Uint8Array> {
    if (!id || id !== this.id || !/^[A-Za-z0-9+/]{43}=$/.test(this.encodedKey)) throw new Error('Encryption secret unavailable');
    const key = Buffer.from(this.encodedKey, 'base64');
    if (key.length !== 32) throw new Error('Encryption secret unavailable');
    return key;
  }
}
