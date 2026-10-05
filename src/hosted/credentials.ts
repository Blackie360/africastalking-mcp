import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { phoneSchema } from '../config.js';
import type { CiphertextBackend, KeyManagement, Principal } from './contracts.js';

export const credentialSchema = z.strictObject({
  apiKey: z.string().min(1).max(1000).regex(/^[^\s\u0000-\u001f]+$/),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  username: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).default('sandbox'),
  mutationsEnabled: z.boolean().default(false),
  dataMutationsEnabled: z.boolean().default(false),
  subscriptionsEnabled: z.boolean().default(false),
  productionOptIn: z.boolean().default(false),
  allowedRecipients: z.array(phoneSchema).max(10).default([]),
}).superRefine((c, ctx) => {
  if ((c.environment === 'sandbox' && (c.username !== 'sandbox' || c.productionOptIn)) ||
      (c.environment === 'production' && (c.username === 'sandbox' || !c.productionOptIn || c.allowedRecipients.length === 0))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid environment policy' });
  }
});
export type Credential = z.infer<typeof credentialSchema>;
export function tenantId(p: Principal): string {
  return createHash('sha256').update(JSON.stringify([p.issuer, p.subject])).digest('hex');
}
const aad = (tenant: string, keyId: string) => Buffer.from(JSON.stringify(['at-mcp-credential', 1, tenant, keyId]));

/** Backend can hold only ciphertext. Policy and API key are authenticated together. */
export class EncryptedCredentialStore {
  constructor(private readonly backend: CiphertextBackend, private readonly keys: KeyManagement) {}
  async put(tenant: string, input: Credential): Promise<void> {
    const credential = credentialSchema.parse(input);
    const keyId = await this.keys.activeKeyId();
    if (!keyId || keyId.length > 128) throw new Error('Key management unavailable');
    const key = await this.keys.encryptionKey(keyId);
    const plaintext = Buffer.from(JSON.stringify(credential));
    try {
      if (key.byteLength !== 32) throw new Error('Invalid encryption key');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(aad(tenant, keyId));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await this.backend.put(tenant, { version: 1, keyId, nonce: Buffer.from(nonce).toString('base64'), ciphertext: Buffer.from(encrypted).toString('base64'), tag: Buffer.from(cipher.getAuthTag()).toString('base64') });
    } finally { key.fill(0); plaintext.fill(0); }
  }
  async get(tenant: string): Promise<Credential | null> {
    const record = await this.backend.get(tenant);
    if (!record) return null;
    if (record.version !== 1 || record.ciphertext.length > 12000 || record.keyId.length > 128) throw new Error('Invalid credential record');
    const key = await this.keys.encryptionKey(record.keyId);
    let plaintext: Buffer | undefined;
    try {
      if (key.byteLength !== 32) throw new Error('Invalid encryption key');
      const nonce = Buffer.from(record.nonce, 'base64'), tag = Buffer.from(record.tag, 'base64');
      if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid credential record');
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(aad(tenant, record.keyId));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
      return credentialSchema.parse(JSON.parse(Buffer.from(plaintext).toString('utf8')));
    } finally { key.fill(0); plaintext?.fill(0); }
  }
  async delete(tenant: string): Promise<void> { await this.backend.delete(tenant); }
}
