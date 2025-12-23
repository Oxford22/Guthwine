/**
 * Guthwine - Main Service
 * Orchestrates all components of the Sovereign Governance Layer
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { VaultService } from './VaultService.js';
import { IdentityService } from './IdentityService.js';
import { DelegationService } from './DelegationService.js';
import { PolicyEngine } from './PolicyEngine.js';
import { LedgerService } from './LedgerService.js';
import { RateLimiter } from './RateLimiter.js';
import { SemanticFirewall, type RiskAssessment } from './SemanticFirewall.js';
import type {
  TransactionRequest,
  TransactionResponse,
  TransactionDecisionType,
  AgentRegistration,
  AgentIdentity,
  DelegationConstraints,
} from '../types/index.js';

export interface GuthwineConfig {
  enableSemanticFirewall: boolean;
  enableRateLimiting: boolean;
  enableSemanticPolicyCheck: boolean;
  rateLimitConfig?: {
    windowSizeMs: number;
    maxAmount: number;
    maxTransactions: number;
  };
  semanticFirewallConfig?: {
    riskThreshold: number;
  };
}

export class GuthwineService {
  private prisma: PrismaClient;
  private vault: VaultService;
  private identity: IdentityService;
  private delegation: DelegationService;
  private policy: PolicyEngine;
  private ledger: LedgerService;
  private rateLimiter: RateLimiter;
  private semanticFirewall: SemanticFirewall;
  private config: GuthwineConfig;
  private jwtSecret: string;

  constructor(config?: Partial<GuthwineConfig>) {
    this.prisma = new PrismaClient();
    this.vault = new VaultService(this.prisma);
    this.identity = new IdentityService(this.prisma, this.vault);
    this.delegation = new DelegationService(this.prisma, this.vault, this.identity);
    this.policy = new PolicyEngine(this.prisma, config?.enableSemanticPolicyCheck ?? true);
    this.ledger = new LedgerService(this.prisma, this.vault);
    this.rateLimiter = new RateLimiter(this.prisma, config?.rateLimitConfig);
    this.semanticFirewall = new SemanticFirewall(config?.semanticFirewallConfig);
    this.jwtSecret = process.env.GUTHWINE_JWT_SECRET || 'default-jwt-secret';

    this.config = {
      enableSemanticFirewall: config?.enableSemanticFirewall ?? true,
      enableRateLimiting: config?.enableRateLimiting ?? true,
      enableSemanticPolicyCheck: config?.enableSemanticPolicyCheck ?? true,
      rateLimitConfig: config?.rateLimitConfig,
      semanticFirewallConfig: config?.semanticFirewallConfig,
    };
  }

  /**
   * Initialize the service (connect to database)
   */
  async initialize(): Promise<void> {
    await this.prisma.$connect();
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  /**
   * Register a new agent
   */
  async registerAgent(registration: AgentRegistration): Promise<AgentIdentity> {
    const agent = await this.identity.registerAgent(registration);

    // Record in audit log
    await this.ledger.recordEntry({
      agentDid: agent.did,
      action: 'AGENT_REGISTERED',
      decision: 'ALLOW',
      decisionReason: 'New agent registered',
    });

    return agent;
  }

  /**
   * Get agent by DID
   */
  async getAgent(did: string): Promise<AgentIdentity | null> {
    return this.identity.getAgentByDid(did);
  }

  /**
   * Freeze an agent (Kill Switch)
   */
  async freezeAgent(did: string, reason: string): Promise<boolean> {
    const success = await this.identity.freezeAgent(did, reason);

    if (success) {
      // Revoke all delegations
      await this.delegation.revokeAllTokensByIssuer(did, `Agent frozen: ${reason}`);

      // Record in audit log
      await this.ledger.recordEntry({
        agentDid: did,
        action: 'AGENT_FROZEN',
        decision: 'ALLOW',
        decisionReason: reason,
      });
    }

    return success;
  }

  /**
   * Unfreeze an agent
   */
  async unfreezeAgent(did: string): Promise<boolean> {
    const success = await this.identity.unfreezeAgent(did);

    if (success) {
      await this.ledger.recordEntry({
        agentDid: did,
        action: 'AGENT_UNFROZEN',
        decision: 'ALLOW',
        decisionReason: 'Agent unfrozen by administrator',
      });
    }

    return success;
  }

  // ============================================================================
  // Transaction Authorization (Core Function)
  // ============================================================================

  /**
   * Request transaction signature - the core authorization function
   */
  async requestTransactionSignature(
    agentDid: string,
    transaction: TransactionRequest,
    delegationChain?: string[]
  ): Promise<TransactionResponse> {
    const violations: string[] = [];
    let decision: TransactionDecisionType = 'ALLOW';
    let riskAssessment: RiskAssessment | undefined;
    let effectiveConstraints: DelegationConstraints | undefined;

    try {
      // 1. Check global freeze
      const globalFreeze = await this.identity.isGlobalFreezeActive();
      if (globalFreeze) {
        return this.createDeniedResponse(
          agentDid,
          transaction,
          'FROZEN',
          'Global system freeze is active',
          delegationChain
        );
      }

      // 2. Check if agent exists and is not frozen
      const agent = await this.identity.getAgentByDid(agentDid);
      if (!agent) {
        return this.createDeniedResponse(
          agentDid,
          transaction,
          'DENY',
          'Agent not found',
          delegationChain
        );
      }

      if (agent.isFrozen) {
        return this.createDeniedResponse(
          agentDid,
          transaction,
          'FROZEN',
          'Agent is frozen',
          delegationChain
        );
      }

      // 3. Verify delegation chain if provided
      if (delegationChain && delegationChain.length > 0) {
        const chainResult = await this.delegation.verifyDelegationChain(
          delegationChain,
          agentDid
        );

        if (!chainResult.valid) {
          return this.createDeniedResponse(
            agentDid,
            transaction,
            'DENY',
            `Delegation chain invalid: ${chainResult.error}`,
            delegationChain
          );
        }

        effectiveConstraints = chainResult.effectiveConstraints;
      }

      // 4. Check rate limits
      if (this.config.enableRateLimiting) {
        const rateLimitStatus = await this.rateLimiter.checkLimit(
          agentDid,
          transaction.amount
        );

        if (rateLimitStatus.isLimited) {
          // Check for anomalies
          const anomalies = await this.rateLimiter.detectAnomalies(agentDid);
          
          if (anomalies.isAnomalous) {
            // Auto-freeze on anomaly detection
            await this.freezeAgent(agentDid, `Anomalous behavior: ${anomalies.reasons.join(', ')}`);
            
            return this.createDeniedResponse(
              agentDid,
              transaction,
              'FROZEN',
              `Rate limit exceeded and anomalous behavior detected: ${anomalies.reasons.join(', ')}`,
              delegationChain
            );
          }

          await this.ledger.recordEntry({
            agentDid,
            action: 'RATE_LIMIT_TRIGGERED',
            amount: transaction.amount,
            currency: transaction.currency,
            merchantId: transaction.merchantId,
            decision: 'DENY',
            decisionReason: 'Rate limit exceeded',
          });

          return this.createDeniedResponse(
            agentDid,
            transaction,
            'DENY',
            `Rate limit exceeded. Current spend: $${rateLimitStatus.currentSpend}, Remaining: $${rateLimitStatus.remainingBudget}`,
            delegationChain
          );
        }
      }

      // 5. Evaluate policies
      const policyResult = await this.policy.evaluateTransaction(
        agentDid,
        transaction,
        effectiveConstraints
      );

      if (!policyResult.allowed) {
        violations.push(...policyResult.violations);
        decision = 'DENY';
      }

      // 6. Semantic firewall check
      if (this.config.enableSemanticFirewall && decision === 'ALLOW') {
        riskAssessment = await this.semanticFirewall.assessRisk(transaction);

        if (riskAssessment.riskLevel === 'CRITICAL') {
          violations.push(`Critical risk detected: ${riskAssessment.reasons.join(', ')}`);
          decision = 'DENY';
        } else if (riskAssessment.requiresHumanApproval) {
          decision = 'PENDING_HUMAN_APPROVAL';
          violations.push(`High risk score (${riskAssessment.riskScore}): Human approval required`);
        }
      }

      // 7. Create policy snapshot for audit
      const policySnapshot = await this.policy.createPolicySnapshot(agentDid);

      // 8. Record in audit log
      const auditLogId = await this.ledger.recordEntry({
        agentDid,
        action: 'REQUEST_SIGNATURE',
        transactionType: 'PAYMENT',
        amount: transaction.amount,
        currency: transaction.currency,
        merchantId: transaction.merchantId,
        reasoningTrace: transaction.reasoningTrace,
        policySnapshotId: policySnapshot.id,
        decision,
        decisionReason: violations.length > 0 ? violations.join('; ') : 'All checks passed',
        delegationChain: delegationChain?.map((t) => this.vault.hash(t)),
      });

      // 9. If allowed, generate mandate and record transaction
      if (decision === 'ALLOW') {
        await this.rateLimiter.recordTransaction(agentDid, transaction.amount);
        await this.identity.updateReputation(agentDid, true);

        const mandate = this.generateMandate(agentDid, transaction, auditLogId);

        return {
          decision: 'ALLOW',
          mandate,
          reason: 'Transaction authorized',
          auditLogId,
          riskScore: riskAssessment?.riskScore,
        };
      }

      // 10. Update reputation for denied transactions
      if (decision === 'DENY') {
        await this.identity.updateReputation(agentDid, false);
      }

      return {
        decision,
        reason: violations.join('; ') || 'Transaction not authorized',
        policyViolations: violations,
        auditLogId,
        riskScore: riskAssessment?.riskScore,
      };
    } catch (error) {
      console.error('Transaction authorization error:', error);

      await this.ledger.recordEntry({
        agentDid,
        action: 'REQUEST_SIGNATURE',
        transactionType: 'PAYMENT',
        amount: transaction.amount,
        currency: transaction.currency,
        merchantId: transaction.merchantId,
        reasoningTrace: transaction.reasoningTrace,
        decision: 'DENY',
        decisionReason: `System error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });

      return {
        decision: 'DENY',
        reason: 'System error during authorization',
        policyViolations: ['Internal error'],
      };
    }
  }

  /**
   * Generate a signed mandate (JWT) for an approved transaction
   */
  private generateMandate(
    agentDid: string,
    transaction: TransactionRequest,
    auditLogId: number
  ): string {
    const payload = {
      iss: 'guthwine',
      sub: agentDid,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5 minute expiry
      txn: {
        amount: transaction.amount,
        currency: transaction.currency,
        merchantId: transaction.merchantId,
      },
      audit: auditLogId,
      nonce: Math.random().toString(36).substr(2, 9),
    };

    return jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
  }

  /**
   * Create a denied response with audit logging
   */
  private async createDeniedResponse(
    agentDid: string,
    transaction: TransactionRequest,
    decision: TransactionDecisionType,
    reason: string,
    delegationChain?: string[]
  ): Promise<TransactionResponse> {
    const auditLogId = await this.ledger.recordEntry({
      agentDid,
      action: 'REQUEST_SIGNATURE',
      transactionType: 'PAYMENT',
      amount: transaction.amount,
      currency: transaction.currency,
      merchantId: transaction.merchantId,
      reasoningTrace: transaction.reasoningTrace,
      decision,
      decisionReason: reason,
      delegationChain: delegationChain?.map((t) => this.vault.hash(t)),
    });

    return {
      decision,
      reason,
      policyViolations: [reason],
      auditLogId,
    };
  }

  // ============================================================================
  // Delegation Management
  // ============================================================================

  /**
   * Issue a delegation token
   */
  async issueDelegation(
    issuerDid: string,
    recipientDid: string,
    constraints: DelegationConstraints
  ): Promise<{ token: string; tokenHash: string }> {
    const result = await this.delegation.issueDelegation(
      issuerDid,
      recipientDid,
      constraints
    );

    await this.ledger.recordEntry({
      agentDid: issuerDid,
      action: 'DELEGATION_ISSUED',
      decision: 'ALLOW',
      decisionReason: `Delegation issued to ${recipientDid}`,
    });

    return result;
  }

  /**
   * Revoke a delegation token
   */
  async revokeDelegation(tokenHash: string, reason: string, revokerDid?: string): Promise<boolean> {
    const success = await this.delegation.revokeToken(tokenHash, reason);

    // Only record audit entry if we have a valid agent DID
    // The revocation itself is already recorded in the delegation token

    return success;
  }

  // ============================================================================
  // Policy Management
  // ============================================================================

  /**
   * Add a policy for an agent
   */
  async addPolicy(
    agentDid: string,
    name: string,
    rules: any,
    options?: {
      description?: string;
      semanticConstraints?: string;
      priority?: number;
    }
  ): Promise<string> {
    return this.policy.addPolicy(agentDid, name, rules, options);
  }

  /**
   * Get policies for an agent
   */
  async getPolicies(agentDid: string): Promise<any[]> {
    return this.policy.getPolicies(agentDid);
  }

  // ============================================================================
  // Audit Trail
  // ============================================================================

  /**
   * Get audit trail
   */
  async getAuditTrail(options: {
    agentDid?: string;
    startTime?: Date;
    endTime?: Date;
    action?: string;
    limit?: number;
  }): Promise<any> {
    return this.ledger.getAuditTrail(options as any);
  }

  /**
   * Verify audit chain integrity
   */
  async verifyAuditIntegrity(): Promise<{
    valid: boolean;
    errors: string[];
    entriesChecked: number;
  }> {
    return this.ledger.verifyChainIntegrity();
  }

  // ============================================================================
  // Vault Management
  // ============================================================================

  /**
   * Store a secret in the vault
   */
  async storeSecret(keyName: string, value: string): Promise<void> {
    await this.vault.storeSecret(keyName, value);
  }

  /**
   * Get a secret from the vault
   */
  async getSecret(keyName: string): Promise<string | null> {
    return this.vault.getSecret(keyName);
  }

  // ============================================================================
  // Getters for sub-services
  // ============================================================================

  getIdentityService(): IdentityService {
    return this.identity;
  }

  getDelegationService(): DelegationService {
    return this.delegation;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policy;
  }

  getLedgerService(): LedgerService {
    return this.ledger;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getSemanticFirewall(): SemanticFirewall {
    return this.semanticFirewall;
  }
}
