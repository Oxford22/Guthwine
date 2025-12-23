/**
 * Agent Key Lifecycle Management
 * 
 * Handles the complete lifecycle of agent cryptographic keys:
 * - Generation ceremony with multi-party approval
 * - Automatic rotation based on policy
 * - Emergency revocation
 * - Key recovery procedures
 */

import * as crypto from 'crypto';
import { HSMManager, KeyCeremonyRequest, KeyCeremonyRecord, KeyMetadata } from './hsm/index.js';

// =============================================================================
// KEY LIFECYCLE TYPES
// =============================================================================

export interface KeyRotationPolicy {
  maxAgeSeconds: number;
  maxUsageCount: number;
  rotateOnCompromise: boolean;
  requireCeremony: boolean;
  minimumQuorum: number;
}

export interface KeyLifecycleEvent {
  eventId: string;
  keyId: string;
  agentId: string;
  organizationId: string;
  eventType: 'GENERATED' | 'ROTATED' | 'DISABLED' | 'ENABLED' | 'REVOKED' | 'RECOVERED';
  timestamp: Date;
  initiatedBy: string;
  reason: string;
  ceremonyId?: string;
  previousKeyVersion?: number;
  newKeyVersion?: number;
  metadata: Record<string, unknown>;
}

export interface EmergencyRevocationRequest {
  agentId: string;
  keyId: string;
  reason: string;
  initiatedBy: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  notifyContacts: string[];
  blockAllTransactions: boolean;
}

export interface KeyRecoveryRequest {
  agentId: string;
  keyId: string;
  reason: string;
  recoveryShares: Buffer[];
  threshold: number;
  initiatedBy: string;
  approvedBy: string[];
}

// =============================================================================
// KEY LIFECYCLE SERVICE
// =============================================================================

export class KeyLifecycleService {
  private hsm: HSMManager;
  private events: KeyLifecycleEvent[] = [];
  private rotationPolicies: Map<string, KeyRotationPolicy> = new Map();

  constructor(hsm: HSMManager) {
    this.hsm = hsm;
  }

  /**
   * Generate a new agent key with ceremony
   */
  async generateAgentKey(
    agentId: string,
    organizationId: string,
    ceremony: KeyCeremonyRequest
  ): Promise<{ keyId: string; publicKey: Buffer; ceremonyRecord: KeyCeremonyRecord }> {
    const keyId = `agent-${agentId}-${Date.now()}`;
    
    // Update ceremony request with key ID
    const fullCeremony: KeyCeremonyRequest = {
      ...ceremony,
      type: 'GENERATION',
      keyId,
    };

    // Execute the ceremony
    const ceremonyRecord = await this.hsm.executeCeremony(fullCeremony);

    // Get the public key
    const provider = this.hsm.getProvider();
    const publicKey = await provider.getPublicKey(keyId);

    // Record the event
    const event = this.recordEvent({
      keyId,
      agentId,
      organizationId,
      eventType: 'GENERATED',
      initiatedBy: ceremony.approvedBy[0] ?? 'unknown',
      reason: ceremony.reason,
      ceremonyId: ceremonyRecord.ceremonyId,
      newKeyVersion: 1,
      metadata: {
        participants: ceremony.participants.length,
        quorum: ceremony.quorum,
      },
    });

    return { keyId, publicKey, ceremonyRecord };
  }

  /**
   * Rotate an agent's key
   */
  async rotateAgentKey(
    agentId: string,
    organizationId: string,
    keyId: string,
    ceremony?: KeyCeremonyRequest
  ): Promise<{ newVersion: number; publicKey: Buffer; ceremonyRecord?: KeyCeremonyRecord }> {
    const provider = this.hsm.getProvider();
    const currentMetadata = await provider.getKeyMetadata(keyId);
    
    if (!currentMetadata) {
      throw new Error(`Key ${keyId} not found`);
    }

    let ceremonyRecord: KeyCeremonyRecord | undefined;

    // Check if ceremony is required
    const policy = this.rotationPolicies.get(keyId);
    if (policy?.requireCeremony || ceremony) {
      if (!ceremony) {
        throw new Error('Key rotation requires a ceremony');
      }

      const fullCeremony: KeyCeremonyRequest = {
        ...ceremony,
        type: 'ROTATION',
        keyId,
      };

      ceremonyRecord = await this.hsm.executeCeremony(fullCeremony);
    } else {
      // Direct rotation without ceremony
      await provider.rotateKey(keyId);
    }

    const newMetadata = await provider.getKeyMetadata(keyId);
    const publicKey = await provider.getPublicKey(keyId);

    // Record the event
    this.recordEvent({
      keyId,
      agentId,
      organizationId,
      eventType: 'ROTATED',
      initiatedBy: ceremony?.approvedBy[0] ?? 'system',
      reason: ceremony?.reason ?? 'Automatic rotation',
      ceremonyId: ceremonyRecord?.ceremonyId,
      previousKeyVersion: currentMetadata.version,
      newKeyVersion: newMetadata!.version,
      metadata: {},
    });

    return {
      newVersion: newMetadata!.version,
      publicKey,
      ceremonyRecord,
    };
  }

  /**
   * Emergency revocation of an agent's key
   */
  async emergencyRevoke(
    request: EmergencyRevocationRequest
  ): Promise<{ success: boolean; event: KeyLifecycleEvent }> {
    const provider = this.hsm.getProvider();

    // Immediately disable the key
    await provider.disableKey(request.keyId);

    // If critical, schedule for destruction
    if (request.severity === 'CRITICAL') {
      await provider.scheduleKeyDestruction(request.keyId, 7); // 7-day grace period
    }

    // Record the event
    const event = this.recordEvent({
      keyId: request.keyId,
      agentId: request.agentId,
      organizationId: '', // Would be looked up
      eventType: 'REVOKED',
      initiatedBy: request.initiatedBy,
      reason: request.reason,
      metadata: {
        severity: request.severity,
        blockAllTransactions: request.blockAllTransactions,
        notifiedContacts: request.notifyContacts,
      },
    });

    // TODO: Send notifications to contacts
    // TODO: Block all pending transactions if requested

    return { success: true, event };
  }

  /**
   * Set rotation policy for a key
   */
  setRotationPolicy(keyId: string, policy: KeyRotationPolicy): void {
    this.rotationPolicies.set(keyId, policy);
  }

  /**
   * Get rotation policy for a key
   */
  getRotationPolicy(keyId: string): KeyRotationPolicy | undefined {
    return this.rotationPolicies.get(keyId);
  }

  /**
   * Check if a key needs rotation based on policy
   */
  async checkRotationNeeded(keyId: string): Promise<{
    needed: boolean;
    reason?: string;
  }> {
    const policy = this.rotationPolicies.get(keyId);
    if (!policy) {
      return { needed: false };
    }

    const provider = this.hsm.getProvider();
    const metadata = await provider.getKeyMetadata(keyId);
    
    if (!metadata) {
      return { needed: false };
    }

    // Check age
    const ageSeconds = (Date.now() - metadata.createdAt.getTime()) / 1000;
    if (ageSeconds > policy.maxAgeSeconds) {
      return { needed: true, reason: 'Key age exceeds policy maximum' };
    }

    // Usage count would be tracked separately
    // if (usageCount > policy.maxUsageCount) {
    //   return { needed: true, reason: 'Key usage exceeds policy maximum' };
    // }

    return { needed: false };
  }

  /**
   * Get all lifecycle events for a key
   */
  getKeyEvents(keyId: string): KeyLifecycleEvent[] {
    return this.events.filter(e => e.keyId === keyId);
  }

  /**
   * Get all lifecycle events for an agent
   */
  getAgentEvents(agentId: string): KeyLifecycleEvent[] {
    return this.events.filter(e => e.agentId === agentId);
  }

  /**
   * Get all lifecycle events for an organization
   */
  getOrganizationEvents(organizationId: string): KeyLifecycleEvent[] {
    return this.events.filter(e => e.organizationId === organizationId);
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private recordEvent(params: Omit<KeyLifecycleEvent, 'eventId' | 'timestamp'>): KeyLifecycleEvent {
    const event: KeyLifecycleEvent = {
      ...params,
      eventId: `evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(),
    };
    this.events.push(event);
    return event;
  }
}

/**
 * Create a key lifecycle service
 */
export function createKeyLifecycleService(hsm: HSMManager): KeyLifecycleService {
  return new KeyLifecycleService(hsm);
}
