/**
 * Guthwine - Key Management Service
 * Ed25519 key generation, encryption, and DID creation
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import bs58 from 'bs58';

const generateKeyPairAsync = promisify(crypto.generateKeyPair);
const pbkdf2Async = promisify(crypto.pbkdf2);
const randomBytesAsync = promisify(crypto.randomBytes);

// Key pair interface
export interface KeyPair {
  publicKey: string;  // PEM format
  privateKey: string; // PEM format
}

// Encrypted data format: iv:authTag:ciphertext (all base64)
export interface EncryptedData {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Generate a new Ed25519 key pair
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const { publicKey, privateKey } = await generateKeyPairAsync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { publicKey, privateKey };
}

/**
 * Derive a master key from a secret and salt using PBKDF2
 */
export async function deriveMasterKey(
  secret: string,
  salt: string,
  iterations: number = 100000
): Promise<Buffer> {
  return pbkdf2Async(secret, salt, iterations, 32, 'sha256');
}

/**
 * Generate a random salt
 */
export async function generateSalt(length: number = 32): Promise<string> {
  const bytes = await randomBytesAsync(length);
  return bytes.toString('base64');
}

/**
 * Encrypt data using AES-256-GCM
 */
export async function encrypt(
  plaintext: string,
  key: Buffer
): Promise<EncryptedData> {
  const iv = await randomBytesAsync(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext,
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(
  encrypted: EncryptedData,
  key: Buffer
): string {
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');
  
  return plaintext;
}

/**
 * Encrypt a private key for storage
 */
export async function encryptPrivateKey(
  privateKey: string,
  masterKey: Buffer
): Promise<string> {
  const encrypted = await encrypt(privateKey, masterKey);
  return `${encrypted.iv}:${encrypted.authTag}:${encrypted.ciphertext}`;
}

/**
 * Decrypt a stored private key
 */
export function decryptPrivateKey(
  encryptedKey: string,
  masterKey: Buffer
): string {
  const [iv, authTag, ciphertext] = encryptedKey.split(':');
  if (!iv || !authTag || !ciphertext) {
    throw new Error('Invalid encrypted key format');
  }
  return decrypt({ iv, authTag, ciphertext }, masterKey);
}

/**
 * Sign data with a private key
 */
export function sign(data: string, privateKey: string): string {
  const signature = crypto.sign(null, Buffer.from(data), privateKey);
  return signature.toString('base64');
}

/**
 * Verify a signature with a public key
 */
export function verify(
  data: string,
  signature: string,
  publicKey: string
): boolean {
  try {
    return crypto.verify(
      null,
      Buffer.from(data),
      publicKey,
      Buffer.from(signature, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * Generate a Guthwine DID from a public key
 * Format: did:guthwine:{base58-encoded-hash}
 */
export function generateDID(publicKey: string): string {
  // Extract raw public key bytes from PEM
  const keyObject = crypto.createPublicKey(publicKey);
  const rawKey = keyObject.export({ type: 'spki', format: 'der' });
  
  // Hash the public key
  const hash = crypto.createHash('sha256').update(rawKey).digest();
  
  // Take first 20 bytes and encode as base58
  const truncatedHash = hash.subarray(0, 20);
  const encoded = bs58.encode(truncatedHash);
  
  return `did:guthwine:${encoded}`;
}

/**
 * Extract the hash portion from a DID
 */
export function extractDIDHash(did: string): string {
  const match = did.match(/^did:guthwine:([a-zA-Z0-9]+)$/);
  if (!match || !match[1]) {
    throw new Error('Invalid Guthwine DID format');
  }
  return match[1];
}

/**
 * Validate a DID format
 */
export function isValidDID(did: string): boolean {
  return /^did:guthwine:[a-zA-Z0-9]+$/.test(did);
}

/**
 * Hash data using SHA-256
 */
export function hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Hash data using SHA-256 and return base64
 */
export function hashBase64(data: string): string {
  return crypto.createHash('sha256').update(data).digest('base64');
}

/**
 * Generate a random ID
 */
export async function generateId(length: number = 16): Promise<string> {
  const bytes = await randomBytesAsync(length);
  return bytes.toString('hex');
}

/**
 * Generate a cryptographically secure random string
 */
export async function generateSecureToken(length: number = 32): Promise<string> {
  const bytes = await randomBytesAsync(length);
  return bytes.toString('base64url');
}

/**
 * HMAC-SHA256 for signing
 */
export function hmacSign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Constant-time string comparison
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
