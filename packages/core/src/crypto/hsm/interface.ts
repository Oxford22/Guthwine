/**
 * HSM (Hardware Security Module) Abstraction Interface
 * 
 * This interface allows Guthwine to work with:
 * - Local software keys (development/testing)
 * - AWS CloudHSM
 * - GCP Cloud KMS
 * - Azure Key Vault
 * - HashiCorp Vault
 * 
 * The master key is never held in memory longer than needed.
 */

// =============================================================================
// KEY TYPES
// =============================================================================

export type KeyAlgorithm = 'ED25519' | 'RSA_2048' | 'RSA_4096' | 'ECDSA_P256' | 'ECDSA_P384';
export type KeyPurpose = 'SIGNING' | 'ENCRYPTION' | 'KEY_WRAPPING';
export type KeyState = 'PENDING_GENERATION' | 'ENABLED' | 'DISABLED' | 'PENDING_DESTRUCTION' | 'DESTROYED';

export interface KeyMetadata {
  keyId: string;
  algorithm: KeyAlgorithm;
  purpose: KeyPurpose;
  state: KeyState;
  version: number;
  createdAt: Date;
  rotatedAt?: Date;
  expiresAt?: Date;
  labels: Record<string, string>;
}

export interface KeyVersion {
  version: number;
  state: KeyState;
  createdAt: Date;
  destroyedAt?: Date;
}

// =============================================================================
// OPERATION TYPES
// =============================================================================

export interface SignRequest {
  keyId: string;
  keyVersion?: number; // Use latest if not specified
  data: Buffer;
  algorithm?: string; // Default based on key type
}

export interface SignResponse {
  signature: Buffer;
  keyVersion: number;
}

export interface VerifyRequest {
  keyId: string;
  keyVersion?: number;
  data: Buffer;
  signature: Buffer;
}

export interface VerifyResponse {
  valid: boolean;
  keyVersion: number;
}

export interface EncryptRequest {
  keyId: string;
  keyVersion?: number;
  plaintext: Buffer;
  additionalAuthenticatedData?: Buffer;
}

export interface EncryptResponse {
  ciphertext: Buffer;
  keyVersion: number;
  nonce?: Buffer;
}

export interface DecryptRequest {
  keyId: string;
  keyVersion?: number;
  ciphertext: Buffer;
  additionalAuthenticatedData?: Buffer;
  nonce?: Buffer;
}

export interface DecryptResponse {
  plaintext: Buffer;
}

export interface WrapKeyRequest {
  wrappingKeyId: string;
  keyToWrap: Buffer;
  additionalAuthenticatedData?: Buffer;
}

export interface WrapKeyResponse {
  wrappedKey: Buffer;
  keyVersion: number;
}

export interface UnwrapKeyRequest {
  wrappingKeyId: string;
  wrappedKey: Buffer;
  keyVersion?: number;
  additionalAuthenticatedData?: Buffer;
}

export interface UnwrapKeyResponse {
  unwrappedKey: Buffer;
}

// =============================================================================
// HSM PROVIDER INTERFACE
// =============================================================================

export interface HSMProvider {
  /**
   * Provider name for logging and identification
   */
  readonly name: string;

  /**
   * Initialize the HSM connection
   */
  initialize(): Promise<void>;

  /**
   * Close the HSM connection
   */
  close(): Promise<void>;

  /**
   * Check if the HSM is healthy and responsive
   */
  healthCheck(): Promise<boolean>;

  // Key Management
  /**
   * Generate a new key in the HSM
   */
  generateKey(
    keyId: string,
    algorithm: KeyAlgorithm,
    purpose: KeyPurpose,
    labels?: Record<string, string>
  ): Promise<KeyMetadata>;

  /**
   * Get key metadata
   */
  getKeyMetadata(keyId: string): Promise<KeyMetadata | null>;

  /**
   * List all key versions
   */
  listKeyVersions(keyId: string): Promise<KeyVersion[]>;

  /**
   * Rotate a key (create new version)
   */
  rotateKey(keyId: string): Promise<KeyMetadata>;

  /**
   * Disable a key (prevent use but don't destroy)
   */
  disableKey(keyId: string): Promise<void>;

  /**
   * Enable a previously disabled key
   */
  enableKey(keyId: string): Promise<void>;

  /**
   * Schedule key destruction (with grace period)
   */
  scheduleKeyDestruction(keyId: string, gracePeriodDays: number): Promise<void>;

  /**
   * Cancel scheduled key destruction
   */
  cancelKeyDestruction(keyId: string): Promise<void>;

  /**
   * Get the public key for asymmetric keys
   */
  getPublicKey(keyId: string, version?: number): Promise<Buffer>;

  // Cryptographic Operations
  /**
   * Sign data with a key
   */
  sign(request: SignRequest): Promise<SignResponse>;

  /**
   * Verify a signature
   */
  verify(request: VerifyRequest): Promise<VerifyResponse>;

  /**
   * Encrypt data with a key
   */
  encrypt(request: EncryptRequest): Promise<EncryptResponse>;

  /**
   * Decrypt data with a key
   */
  decrypt(request: DecryptRequest): Promise<DecryptResponse>;

  /**
   * Wrap (encrypt) another key
   */
  wrapKey(request: WrapKeyRequest): Promise<WrapKeyResponse>;

  /**
   * Unwrap (decrypt) a wrapped key
   */
  unwrapKey(request: UnwrapKeyRequest): Promise<UnwrapKeyResponse>;
}

// =============================================================================
// HSM CONFIGURATION
// =============================================================================

export interface LocalHSMConfig {
  type: 'local';
  masterKeyPath?: string; // Path to master key file
  masterKeyEnvVar?: string; // Environment variable containing master key
}

export interface AWSCloudHSMConfig {
  type: 'aws-cloudhsm';
  clusterId: string;
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface AWSKMSConfig {
  type: 'aws-kms';
  region: string;
  keyArn?: string; // Master key ARN
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface GCPCloudKMSConfig {
  type: 'gcp-kms';
  projectId: string;
  location: string;
  keyRing: string;
  credentials?: string; // Path to service account JSON
}

export interface AzureKeyVaultConfig {
  type: 'azure-keyvault';
  vaultUrl: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface HashiCorpVaultConfig {
  type: 'hashicorp-vault';
  address: string;
  token?: string;
  namespace?: string;
  transitPath?: string;
}

export type HSMConfig =
  | LocalHSMConfig
  | AWSCloudHSMConfig
  | AWSKMSConfig
  | GCPCloudKMSConfig
  | AzureKeyVaultConfig
  | HashiCorpVaultConfig;

// =============================================================================
// KEY CEREMONY TYPES
// =============================================================================

export interface KeyCeremonyParticipant {
  id: string;
  name: string;
  email: string;
  publicKey: string;
}

export interface KeyCeremonyRecord {
  ceremonyId: string;
  type: 'GENERATION' | 'ROTATION' | 'RECOVERY' | 'DESTRUCTION';
  keyId: string;
  keyVersion?: number;
  participants: KeyCeremonyParticipant[];
  quorum: number;
  timestamp: Date;
  location?: string;
  witnesses: string[];
  videoRecordingUrl?: string;
  auditLogHash: string;
}

export interface KeyCeremonyRequest {
  type: 'GENERATION' | 'ROTATION' | 'RECOVERY' | 'DESTRUCTION';
  keyId: string;
  participants: KeyCeremonyParticipant[];
  quorum: number;
  reason: string;
  approvedBy: string[];
}
