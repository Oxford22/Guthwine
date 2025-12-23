/**
 * HSM Manager
 * 
 * Factory and manager for HSM providers.
 * Handles provider selection, initialization, and lifecycle.
 */

import {
  HSMProvider,
  HSMConfig,
  KeyCeremonyRecord,
  KeyCeremonyRequest,
} from './interface.js';
import { LocalHSMProvider } from './local.js';

// =============================================================================
// HSM MANAGER
// =============================================================================

export class HSMManager {
  private provider: HSMProvider | null = null;
  private config: HSMConfig;
  private ceremonyRecords: KeyCeremonyRecord[] = [];

  constructor(config: HSMConfig) {
    this.config = config;
  }

  /**
   * Initialize the HSM provider based on configuration
   */
  async initialize(): Promise<void> {
    this.provider = this.createProvider();
    await this.provider.initialize();
  }

  /**
   * Get the current HSM provider
   */
  getProvider(): HSMProvider {
    if (!this.provider) {
      throw new Error('HSM not initialized. Call initialize() first.');
    }
    return this.provider;
  }

  /**
   * Close the HSM connection
   */
  async close(): Promise<void> {
    if (this.provider) {
      await this.provider.close();
      this.provider = null;
    }
  }

  /**
   * Check HSM health
   */
  async healthCheck(): Promise<boolean> {
    if (!this.provider) return false;
    return this.provider.healthCheck();
  }

  // =============================================================================
  // KEY CEREMONY MANAGEMENT
  // =============================================================================

  /**
   * Record a key ceremony for audit purposes
   */
  recordCeremony(ceremony: KeyCeremonyRecord): void {
    this.ceremonyRecords.push(ceremony);
  }

  /**
   * Get all ceremony records
   */
  getCeremonyRecords(): KeyCeremonyRecord[] {
    return [...this.ceremonyRecords];
  }

  /**
   * Get ceremony records for a specific key
   */
  getCeremonyRecordsForKey(keyId: string): KeyCeremonyRecord[] {
    return this.ceremonyRecords.filter(r => r.keyId === keyId);
  }

  /**
   * Validate a key ceremony request
   */
  validateCeremonyRequest(request: KeyCeremonyRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.keyId) {
      errors.push('Key ID is required');
    }

    if (request.participants.length < request.quorum) {
      errors.push(`Not enough participants (${request.participants.length}) for quorum (${request.quorum})`);
    }

    if (request.quorum < 2) {
      errors.push('Quorum must be at least 2 for security');
    }

    if (!request.reason || request.reason.length < 10) {
      errors.push('A detailed reason is required (at least 10 characters)');
    }

    if (request.approvedBy.length < 2) {
      errors.push('At least 2 approvers are required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Execute a key ceremony
   */
  async executeCeremony(request: KeyCeremonyRequest): Promise<KeyCeremonyRecord> {
    const validation = this.validateCeremonyRequest(request);
    if (!validation.valid) {
      throw new Error(`Invalid ceremony request: ${validation.errors.join(', ')}`);
    }

    const provider = this.getProvider();
    const ceremonyId = `ceremony-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let keyVersion: number | undefined;

    switch (request.type) {
      case 'GENERATION':
        const metadata = await provider.generateKey(
          request.keyId,
          'ED25519',
          'SIGNING',
          { ceremony: ceremonyId }
        );
        keyVersion = metadata.version;
        break;

      case 'ROTATION':
        const rotated = await provider.rotateKey(request.keyId);
        keyVersion = rotated.version;
        break;

      case 'DESTRUCTION':
        await provider.scheduleKeyDestruction(request.keyId, 30); // 30-day grace period
        break;

      case 'RECOVERY':
        // Recovery would involve reconstructing from key shares
        throw new Error('Key recovery not implemented');
    }

    const record: KeyCeremonyRecord = {
      ceremonyId,
      type: request.type,
      keyId: request.keyId,
      keyVersion,
      participants: request.participants,
      quorum: request.quorum,
      timestamp: new Date(),
      witnesses: request.approvedBy,
      auditLogHash: this.computeAuditHash(request, ceremonyId),
    };

    this.recordCeremony(record);

    return record;
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private createProvider(): HSMProvider {
    switch (this.config.type) {
      case 'local':
        return new LocalHSMProvider(this.config);

      case 'aws-cloudhsm':
        // Would implement AWS CloudHSM provider
        throw new Error('AWS CloudHSM provider not implemented');

      case 'aws-kms':
        // Would implement AWS KMS provider
        throw new Error('AWS KMS provider not implemented');

      case 'gcp-kms':
        // Would implement GCP Cloud KMS provider
        throw new Error('GCP Cloud KMS provider not implemented');

      case 'azure-keyvault':
        // Would implement Azure Key Vault provider
        throw new Error('Azure Key Vault provider not implemented');

      case 'hashicorp-vault':
        // Would implement HashiCorp Vault provider
        throw new Error('HashiCorp Vault provider not implemented');

      default:
        throw new Error(`Unknown HSM type: ${(this.config as any).type}`);
    }
  }

  private computeAuditHash(request: KeyCeremonyRequest, ceremonyId: string): string {
    const crypto = require('crypto');
    const data = JSON.stringify({
      ceremonyId,
      type: request.type,
      keyId: request.keyId,
      participants: request.participants.map(p => p.id),
      quorum: request.quorum,
      reason: request.reason,
      approvedBy: request.approvedBy,
      timestamp: new Date().toISOString(),
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * Create an HSM manager instance
 */
export function createHSMManager(config: HSMConfig): HSMManager {
  return new HSMManager(config);
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let globalHSMManager: HSMManager | null = null;

/**
 * Get or create the global HSM manager
 */
export function getHSMManager(config?: HSMConfig): HSMManager {
  if (!globalHSMManager) {
    if (!config) {
      // Default to local HSM for development
      config = { type: 'local' };
    }
    globalHSMManager = createHSMManager(config);
  }
  return globalHSMManager;
}

/**
 * Reset the global HSM manager (for testing)
 */
export async function resetHSMManager(): Promise<void> {
  if (globalHSMManager) {
    await globalHSMManager.close();
    globalHSMManager = null;
  }
}
