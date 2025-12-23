/**
 * Key Recovery Service using Verifiable Secret Sharing
 * 
 * Provides enterprise-grade key recovery with:
 * - Geographically distributed key shards
 * - Threshold-based recovery (e.g., 3-of-5)
 * - Cryptographic verification of share integrity
 * - Audit trail for recovery attempts
 */

import * as crypto from 'crypto';
import { FeldmanVSS, Share, Commitment, VSSResult } from './feldman-vss.js';

export interface KeyShard {
  id: string;
  index: number;
  encryptedShare: string;
  shareHash: string;
  custodianId: string;
  createdAt: Date;
  lastVerified?: Date;
}

export interface KeyRecoveryConfig {
  threshold: number;
  totalShards: number;
  keyId: string;
  organizationId: string;
  custodians: CustodianInfo[];
}

export interface CustodianInfo {
  id: string;
  name: string;
  publicKey: string;
  location?: string;
  contactEmail?: string;
}

export interface RecoveryAttempt {
  id: string;
  keyId: string;
  initiatedBy: string;
  initiatedAt: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  shardsCollected: number;
  shardsRequired: number;
  completedAt?: Date;
  reason?: string;
}

export interface ShardSubmission {
  shardId: string;
  custodianId: string;
  encryptedShare: string;
  signature: string;
  submittedAt: Date;
}

/**
 * Key Recovery Service
 */
export class KeyRecoveryService {
  private vss: FeldmanVSS;
  
  // In production, these would be stored in a secure database
  private keyConfigs: Map<string, KeyRecoveryConfig> = new Map();
  private keyShards: Map<string, KeyShard[]> = new Map();
  private commitments: Map<string, Commitment[]> = new Map();
  private recoveryAttempts: Map<string, RecoveryAttempt> = new Map();
  
  constructor() {
    this.vss = new FeldmanVSS();
  }
  
  /**
   * Initialize key sharding for a master key
   * 
   * @param masterKey - The key to shard (hex string)
   * @param config - Recovery configuration
   * @returns Encrypted shards for distribution to custodians
   */
  async initializeKeySharding(
    masterKey: string,
    config: KeyRecoveryConfig
  ): Promise<{ shards: KeyShard[]; commitments: string }> {
    if (config.custodians.length !== config.totalShards) {
      throw new Error('Number of custodians must match total shards');
    }
    
    // Split the key using Feldman VSS
    const vssResult = this.vss.split(masterKey, config.threshold, config.totalShards);
    
    // Create encrypted shards for each custodian
    const shards: KeyShard[] = [];
    
    for (let i = 0; i < vssResult.shares.length; i++) {
      const share = vssResult.shares[i];
      const custodian = config.custodians[i];
      
      if (!share || !custodian) {
        continue;
      }
      
      // Encrypt share with custodian's public key
      // In production, use proper asymmetric encryption (RSA-OAEP or ECIES)
      const encryptedShare = this.encryptForCustodian(
        this.vss.serializeShare(share),
        custodian.publicKey
      );
      
      // Create hash for integrity verification
      const shareHash = crypto
        .createHash('sha256')
        .update(this.vss.serializeShare(share))
        .digest('hex');
      
      const shard: KeyShard = {
        id: crypto.randomUUID(),
        index: share.index,
        encryptedShare,
        shareHash,
        custodianId: custodian.id,
        createdAt: new Date(),
      };
      
      shards.push(shard);
    }
    
    // Store configuration and commitments
    this.keyConfigs.set(config.keyId, config);
    this.keyShards.set(config.keyId, shards);
    this.commitments.set(config.keyId, vssResult.commitments);
    
    return {
      shards,
      commitments: this.vss.serializeCommitments(vssResult.commitments),
    };
  }
  
  /**
   * Initiate a key recovery process
   */
  initiateRecovery(
    keyId: string,
    initiatedBy: string,
    reason: string
  ): RecoveryAttempt {
    const config = this.keyConfigs.get(keyId);
    if (!config) {
      throw new Error(`Key configuration not found: ${keyId}`);
    }
    
    const attempt: RecoveryAttempt = {
      id: crypto.randomUUID(),
      keyId,
      initiatedBy,
      initiatedAt: new Date(),
      status: 'pending',
      shardsCollected: 0,
      shardsRequired: config.threshold,
      reason,
    };
    
    this.recoveryAttempts.set(attempt.id, attempt);
    
    return attempt;
  }
  
  /**
   * Submit a shard for recovery
   */
  submitShard(
    attemptId: string,
    submission: ShardSubmission
  ): { accepted: boolean; shardsRemaining: number; error?: string } {
    const attempt = this.recoveryAttempts.get(attemptId);
    if (!attempt) {
      return { accepted: false, shardsRemaining: -1, error: 'Recovery attempt not found' };
    }
    
    if (attempt.status !== 'pending' && attempt.status !== 'in_progress') {
      return { accepted: false, shardsRemaining: -1, error: `Recovery attempt is ${attempt.status}` };
    }
    
    const config = this.keyConfigs.get(attempt.keyId);
    if (!config) {
      return { accepted: false, shardsRemaining: -1, error: 'Key configuration not found' };
    }
    
    // Verify custodian signature
    // In production, verify using custodian's public key
    
    // Update attempt status
    attempt.status = 'in_progress';
    attempt.shardsCollected++;
    
    const shardsRemaining = config.threshold - attempt.shardsCollected;
    
    return {
      accepted: true,
      shardsRemaining: Math.max(0, shardsRemaining),
    };
  }
  
  /**
   * Complete recovery and reconstruct the key
   */
  completeRecovery(
    attemptId: string,
    decryptedShares: Share[]
  ): { success: boolean; recoveredKey?: string; error?: string } {
    const attempt = this.recoveryAttempts.get(attemptId);
    if (!attempt) {
      return { success: false, error: 'Recovery attempt not found' };
    }
    
    const config = this.keyConfigs.get(attempt.keyId);
    if (!config) {
      return { success: false, error: 'Key configuration not found' };
    }
    
    const storedCommitments = this.commitments.get(attempt.keyId);
    if (!storedCommitments) {
      return { success: false, error: 'Commitments not found' };
    }
    
    try {
      // Verify and reconstruct
      const result = this.vss.reconstructWithVerification(
        decryptedShares,
        storedCommitments,
        config.threshold
      );
      
      // Update attempt status
      attempt.status = 'completed';
      attempt.completedAt = new Date();
      
      // Convert bigint to hex string
      const recoveredKey = result.secret.toString(16).padStart(64, '0');
      
      return {
        success: true,
        recoveredKey,
      };
    } catch (error) {
      attempt.status = 'failed';
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Verify a shard without revealing it
   */
  verifyShard(
    keyId: string,
    share: Share
  ): { valid: boolean; error?: string } {
    const storedCommitments = this.commitments.get(keyId);
    if (!storedCommitments) {
      return { valid: false, error: 'Commitments not found' };
    }
    
    const verification = this.vss.verifyShare(share, storedCommitments);
    
    return {
      valid: verification.isValid,
      error: verification.isValid ? undefined : 'Share verification failed',
    };
  }
  
  /**
   * Rotate key shards (re-share without changing the secret)
   * 
   * This is useful for:
   * - Replacing a compromised custodian
   * - Refreshing shares periodically
   * - Changing the threshold
   */
  async rotateShards(
    keyId: string,
    existingShares: Share[],
    newConfig: KeyRecoveryConfig
  ): Promise<{ shards: KeyShard[]; commitments: string }> {
    const oldConfig = this.keyConfigs.get(keyId);
    if (!oldConfig) {
      throw new Error(`Key configuration not found: ${keyId}`);
    }
    
    const storedCommitments = this.commitments.get(keyId);
    if (!storedCommitments) {
      throw new Error('Commitments not found');
    }
    
    // Reconstruct the secret
    const result = this.vss.reconstructWithVerification(
      existingShares,
      storedCommitments,
      oldConfig.threshold
    );
    
    // Re-shard with new configuration
    const masterKey = result.secret.toString(16).padStart(64, '0');
    
    return this.initializeKeySharding(masterKey, newConfig);
  }
  
  /**
   * Get recovery attempt status
   */
  getRecoveryStatus(attemptId: string): RecoveryAttempt | undefined {
    return this.recoveryAttempts.get(attemptId);
  }
  
  /**
   * Cancel a recovery attempt
   */
  cancelRecovery(attemptId: string, cancelledBy: string): boolean {
    const attempt = this.recoveryAttempts.get(attemptId);
    if (!attempt) {
      return false;
    }
    
    if (attempt.status === 'completed' || attempt.status === 'failed') {
      return false;
    }
    
    attempt.status = 'cancelled';
    attempt.completedAt = new Date();
    
    return true;
  }
  
  /**
   * Encrypt share for a custodian
   * In production, use proper asymmetric encryption
   */
  private encryptForCustodian(share: string, publicKey: string): string {
    // Simplified encryption - in production use RSA-OAEP or ECIES
    const key = crypto.createHash('sha256').update(publicKey).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(share, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
      iv: iv.toString('hex'),
      encrypted,
      authTag: authTag.toString('hex'),
    });
  }
  
  /**
   * Decrypt share (custodian side)
   */
  decryptShare(encryptedShare: string, privateKey: string): Share {
    const { iv, encrypted, authTag } = JSON.parse(encryptedShare);
    
    // Derive key from private key (simplified)
    const key = crypto.createHash('sha256').update(privateKey).digest();
    
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return this.vss.deserializeShare(decrypted);
  }
}

/**
 * Emergency Override Key Manager
 * 
 * Manages the "Root Override Key" mentioned in the VAGNN architecture.
 * This key can pause the system and perform rollbacks.
 */
export class EmergencyOverrideManager {
  private keyRecovery: KeyRecoveryService;
  private overrideKeyId: string = 'root-override-key';
  
  constructor() {
    this.keyRecovery = new KeyRecoveryService();
  }
  
  /**
   * Initialize the emergency override key with council members
   */
  async initializeOverrideKey(
    councilMembers: CustodianInfo[],
    threshold: number = 3
  ): Promise<{ shards: KeyShard[]; publicCommitments: string }> {
    // Generate a new random override key
    const overrideKey = crypto.randomBytes(32).toString('hex');
    
    const config: KeyRecoveryConfig = {
      threshold,
      totalShards: councilMembers.length,
      keyId: this.overrideKeyId,
      organizationId: 'system',
      custodians: councilMembers,
    };
    
    const result = await this.keyRecovery.initializeKeySharding(overrideKey, config);
    
    return {
      shards: result.shards,
      publicCommitments: result.commitments,
    };
  }
  
  /**
   * Initiate emergency recovery process
   */
  initiateEmergencyRecovery(
    initiatedBy: string,
    reason: string
  ): RecoveryAttempt {
    return this.keyRecovery.initiateRecovery(
      this.overrideKeyId,
      initiatedBy,
      reason
    );
  }
  
  /**
   * Submit council member's shard
   */
  submitCouncilShard(
    attemptId: string,
    submission: ShardSubmission
  ): { accepted: boolean; shardsRemaining: number; error?: string } {
    return this.keyRecovery.submitShard(attemptId, submission);
  }
  
  /**
   * Complete emergency recovery and execute override action
   */
  async executeEmergencyOverride(
    attemptId: string,
    decryptedShares: Share[],
    action: 'pause' | 'rollback' | 'unfreeze'
  ): Promise<{ success: boolean; actionExecuted?: string; error?: string }> {
    const result = this.keyRecovery.completeRecovery(attemptId, decryptedShares);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // Verify the recovered key can sign an override action
    // In production, this would interact with the actual system
    
    return {
      success: true,
      actionExecuted: action,
    };
  }
}

export { FeldmanVSS };
export type { Share, Commitment, VSSResult };
