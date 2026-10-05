/** Infrastructure contracts. No permissive/default production implementations. */
export interface Principal {
  issuer: string;
  subject: string;
  audience: string;
  scopes: readonly string[];
  expiresAt: number;
}
export interface BrowserSession {
  principal: Principal;
  csrfToken: string;
  /** Unix seconds of the most recent actual authentication, not refresh. */
  authenticatedAt: number;
}
export interface IdentityProvider {
  /** MUST cryptographically validate signature, issuer, audience, expiry and revocation. */
  verifyAccessToken(token: string): Promise<Principal | null>;
  /** MUST use a secure HttpOnly SameSite session; never trust client identity headers. */
  browserSession(request: Request): Promise<BrowserSession | null>;
}
export interface EncryptedRecord {
  version: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}
export interface CiphertextBackend {
  get(tenant: string): Promise<EncryptedRecord | null>;
  put(tenant: string, record: EncryptedRecord): Promise<void>;
  delete(tenant: string): Promise<void>;
}
export interface KeyManagement {
  /** Deployment secret/KMS backed; never generate a fallback or derive from user data. */
  activeKeyId(): Promise<string>;
  /** Return an independent 32-byte buffer which the caller can wipe after use. */
  encryptionKey(keyId: string): Promise<Uint8Array>;
}
export interface RateLimits {
  /** Atomic across replicas; false denies. Backend failure MUST throw. */
  consume(tenant: string, bucket: 'request' | 'send' | 'credential', limit: number, windowSeconds: number): Promise<boolean>;
}
export interface DedupeStore {
  /** Atomic put-if-absent with expiry across replicas. Retain after every outcome. */
  reserve(tenant: string, digest: string, ttlSeconds: number): Promise<boolean>;
}
export interface HostedConfig {
  /** Exact canonical HTTPS URL ending in /mcp. No secrets, query or fragment. */
  resource: string;
  authorizationServer: string;
  /** Exact browser origins. Requests without Origin are permitted for native MCP clients. */
  allowedOrigins: readonly string[];
  productionEnabled: boolean;
}
export const SCOPES = ['mcp:use', 'credentials:manage', 'sms:send', 'airtime:send', 'production:use'] as const;
