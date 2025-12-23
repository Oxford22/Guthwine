/**
 * Local HSM Provider
 * 
 * Software-based HSM implementation for development and testing.
 * Uses Node.js crypto module with AES-256-GCM for key wrapping.
 * 
 * WARNING: This is NOT suitable for production use with sensitive data.
 * Use a real HSM (AWS CloudHSM, GCP Cloud KMS, etc.) in production.
 */

import * as crypto from 'crypto';
import {
  HSMProvider,
  KeyAlgorithm,
  KeyPurpose,
  KeyState,
  KeyMetadata,
  KeyVersion,
  SignRequest,
  SignResponse,
  VerifyRequest,
  VerifyResponse,
  EncryptRequest,
  EncryptResponse,
  DecryptRequest,
  DecryptResponse,
  WrapKeyRequest,
  WrapKeyResponse,
  UnwrapKeyRequest,
  UnwrapKeyResponse,
  LocalHSMConfig,
} from './interface.js';

// =============================================================================
// INTERNAL KEY STORAGE
// =============================================================================

interface StoredKey {
  metadata: KeyMetadata;
  versions: Map<number, {
    privateKey?: crypto.KeyObject;
    publicKey?: crypto.KeyObject;
    symmetricKey?: Buffer;
    state: KeyState;
    createdAt: Date;
    destroyedAt?: Date;
  }>;
}

// =============================================================================
// LOCAL HSM PROVIDER
// =============================================================================

export class LocalHSMProvider implements HSMProvider {
  readonly name = 'local';
  
  private masterKey: Buffer | null = null;
  private keys: Map<string, StoredKey> = new Map();
  private initialized = false;
  private config: LocalHSMConfig;

  constructor(config: LocalHSMConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load master key from environment or file
    if (this.config.masterKeyEnvVar) {
      const keyHex = process.env[this.config.masterKeyEnvVar];
      if (!keyHex) {
        throw new Error(`Master key environment variable ${this.config.masterKeyEnvVar} not set`);
      }
      this.masterKey = Buffer.from(keyHex, 'hex');
    } else if (this.config.masterKeyPath) {
      // In production, this would read from a secure file
      throw new Error('File-based master key not implemented');
    } else {
      // Generate ephemeral master key for development
      console.warn('WARNING: Using ephemeral master key. Keys will be lost on restart.');
      this.masterKey = crypto.randomBytes(32);
    }

    if (this.masterKey.length !== 32) {
      throw new Error('Master key must be 32 bytes (256 bits)');
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    // Securely clear master key from memory
    if (this.masterKey) {
      this.masterKey.fill(0);
      this.masterKey = null;
    }
    this.keys.clear();
    this.initialized = false;
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized && this.masterKey !== null;
  }

  // =============================================================================
  // KEY MANAGEMENT
  // =============================================================================

  async generateKey(
    keyId: string,
    algorithm: KeyAlgorithm,
    purpose: KeyPurpose,
    labels: Record<string, string> = {}
  ): Promise<KeyMetadata> {
    this.ensureInitialized();

    if (this.keys.has(keyId)) {
      throw new Error(`Key ${keyId} already exists`);
    }

    const now = new Date();
    const version = 1;

    const keyData = this.generateKeyMaterial(algorithm, purpose);

    const metadata: KeyMetadata = {
      keyId,
      algorithm,
      purpose,
      state: 'ENABLED',
      version,
      createdAt: now,
      labels,
    };

    const storedKey: StoredKey = {
      metadata,
      versions: new Map([[version, {
        ...keyData,
        state: 'ENABLED',
        createdAt: now,
      }]]),
    };

    this.keys.set(keyId, storedKey);

    return metadata;
  }

  async getKeyMetadata(keyId: string): Promise<KeyMetadata | null> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    return key?.metadata ?? null;
  }

  async listKeyVersions(keyId: string): Promise<KeyVersion[]> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    return Array.from(key.versions.entries()).map(([version, data]) => ({
      version,
      state: data.state,
      createdAt: data.createdAt,
      destroyedAt: data.destroyedAt,
    }));
  }

  async rotateKey(keyId: string): Promise<KeyMetadata> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    const now = new Date();
    const newVersion = key.metadata.version + 1;

    const keyData = this.generateKeyMaterial(key.metadata.algorithm, key.metadata.purpose);

    key.versions.set(newVersion, {
      ...keyData,
      state: 'ENABLED',
      createdAt: now,
    });

    key.metadata.version = newVersion;
    key.metadata.rotatedAt = now;

    return key.metadata;
  }

  async disableKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }
    key.metadata.state = 'DISABLED';
  }

  async enableKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }
    if (key.metadata.state === 'DESTROYED') {
      throw new Error('Cannot enable a destroyed key');
    }
    key.metadata.state = 'ENABLED';
  }

  async scheduleKeyDestruction(keyId: string, gracePeriodDays: number): Promise<void> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }
    key.metadata.state = 'PENDING_DESTRUCTION';
    key.metadata.expiresAt = new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000);
  }

  async cancelKeyDestruction(keyId: string): Promise<void> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }
    if (key.metadata.state !== 'PENDING_DESTRUCTION') {
      throw new Error('Key is not pending destruction');
    }
    key.metadata.state = 'DISABLED';
    key.metadata.expiresAt = undefined;
  }

  async getPublicKey(keyId: string, version?: number): Promise<Buffer> {
    this.ensureInitialized();
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    const v = version ?? key.metadata.version;
    const keyVersion = key.versions.get(v);
    if (!keyVersion) {
      throw new Error(`Key version ${v} not found`);
    }

    if (!keyVersion.publicKey) {
      throw new Error('Key does not have a public key');
    }

    return keyVersion.publicKey.export({ type: 'spki', format: 'der' });
  }

  // =============================================================================
  // CRYPTOGRAPHIC OPERATIONS
  // =============================================================================

  async sign(request: SignRequest): Promise<SignResponse> {
    this.ensureInitialized();
    const key = this.keys.get(request.keyId);
    if (!key) {
      throw new Error(`Key ${request.keyId} not found`);
    }

    const version = request.keyVersion ?? key.metadata.version;
    const keyVersion = key.versions.get(version);
    if (!keyVersion) {
      throw new Error(`Key version ${version} not found`);
    }

    if (keyVersion.state !== 'ENABLED') {
      throw new Error('Key version is not enabled');
    }

    if (!keyVersion.privateKey) {
      throw new Error('Key does not have a private key');
    }

    const signature = crypto.sign(null, request.data, keyVersion.privateKey);

    return {
      signature,
      keyVersion: version,
    };
  }

  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    this.ensureInitialized();
    const key = this.keys.get(request.keyId);
    if (!key) {
      throw new Error(`Key ${request.keyId} not found`);
    }

    const version = request.keyVersion ?? key.metadata.version;
    const keyVersion = key.versions.get(version);
    if (!keyVersion) {
      throw new Error(`Key version ${version} not found`);
    }

    if (!keyVersion.publicKey) {
      throw new Error('Key does not have a public key');
    }

    const valid = crypto.verify(null, request.data, keyVersion.publicKey, request.signature);

    return {
      valid,
      keyVersion: version,
    };
  }

  async encrypt(request: EncryptRequest): Promise<EncryptResponse> {
    this.ensureInitialized();
    const key = this.keys.get(request.keyId);
    if (!key) {
      throw new Error(`Key ${request.keyId} not found`);
    }

    const version = request.keyVersion ?? key.metadata.version;
    const keyVersion = key.versions.get(version);
    if (!keyVersion) {
      throw new Error(`Key version ${version} not found`);
    }

    if (keyVersion.state !== 'ENABLED') {
      throw new Error('Key version is not enabled');
    }

    if (!keyVersion.symmetricKey) {
      throw new Error('Key is not a symmetric key');
    }

    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyVersion.symmetricKey, nonce);
    
    if (request.additionalAuthenticatedData) {
      cipher.setAAD(request.additionalAuthenticatedData);
    }

    const encrypted = Buffer.concat([cipher.update(request.plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, authTag]);

    return {
      ciphertext,
      keyVersion: version,
      nonce,
    };
  }

  async decrypt(request: DecryptRequest): Promise<DecryptResponse> {
    this.ensureInitialized();
    const key = this.keys.get(request.keyId);
    if (!key) {
      throw new Error(`Key ${request.keyId} not found`);
    }

    const version = request.keyVersion ?? key.metadata.version;
    const keyVersion = key.versions.get(version);
    if (!keyVersion) {
      throw new Error(`Key version ${version} not found`);
    }

    if (!keyVersion.symmetricKey) {
      throw new Error('Key is not a symmetric key');
    }

    if (!request.nonce) {
      throw new Error('Nonce is required for decryption');
    }

    const authTag = request.ciphertext.slice(-16);
    const encrypted = request.ciphertext.slice(0, -16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyVersion.symmetricKey, request.nonce);
    decipher.setAuthTag(authTag);
    
    if (request.additionalAuthenticatedData) {
      decipher.setAAD(request.additionalAuthenticatedData);
    }

    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return { plaintext };
  }

  async wrapKey(request: WrapKeyRequest): Promise<WrapKeyResponse> {
    this.ensureInitialized();
    
    // Use the master key for wrapping
    if (!this.masterKey) {
      throw new Error('Master key not available');
    }

    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, nonce);
    
    if (request.additionalAuthenticatedData) {
      cipher.setAAD(request.additionalAuthenticatedData);
    }

    const encrypted = Buffer.concat([cipher.update(request.keyToWrap), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Format: nonce (12) + ciphertext + authTag (16)
    const wrappedKey = Buffer.concat([nonce, encrypted, authTag]);

    return {
      wrappedKey,
      keyVersion: 1, // Master key version
    };
  }

  async unwrapKey(request: UnwrapKeyRequest): Promise<UnwrapKeyResponse> {
    this.ensureInitialized();
    
    if (!this.masterKey) {
      throw new Error('Master key not available');
    }

    // Parse wrapped key: nonce (12) + ciphertext + authTag (16)
    const nonce = request.wrappedKey.slice(0, 12);
    const authTag = request.wrappedKey.slice(-16);
    const encrypted = request.wrappedKey.slice(12, -16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, nonce);
    decipher.setAuthTag(authTag);
    
    if (request.additionalAuthenticatedData) {
      decipher.setAAD(request.additionalAuthenticatedData);
    }

    const unwrappedKey = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return { unwrappedKey };
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('HSM not initialized. Call initialize() first.');
    }
  }

  private generateKeyMaterial(algorithm: KeyAlgorithm, purpose: KeyPurpose): {
    privateKey?: crypto.KeyObject;
    publicKey?: crypto.KeyObject;
    symmetricKey?: Buffer;
  } {
    switch (algorithm) {
      case 'ED25519': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        return { publicKey, privateKey };
      }
      case 'RSA_2048': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
        });
        return { publicKey, privateKey };
      }
      case 'RSA_4096': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: 4096,
        });
        return { publicKey, privateKey };
      }
      case 'ECDSA_P256': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
        });
        return { publicKey, privateKey };
      }
      case 'ECDSA_P384': {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
          namedCurve: 'secp384r1',
        });
        return { publicKey, privateKey };
      }
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }
}

/**
 * Create a local HSM provider instance
 */
export function createLocalHSM(config: LocalHSMConfig = { type: 'local' }): LocalHSMProvider {
  return new LocalHSMProvider(config);
}
