/**
 * Guthwine Service
 * Main orchestration service for the Sovereign Governance Layer
 */

import { v4 as uuidv4 } from 'uuid';
import {
  generateKeyPair,
  generateDID,
  encryptPrivateKey,
  deriveMasterKey,
  generateSalt,
  hash,
  sign,
} from '@guthwine/core';
import { prisma, cacheGet, cacheSet, cacheDelete, publish, Prisma } from '@guthwine/database';
import { PolicyEngine } from './policy-engine.js';
import { SemanticFirewall } from './semantic-firewall.js';
import { DelegationService } from './delegation-service.js';
import { PaymentRailService } from './payment-rails.js';

// Cache key prefixes
const CACHE_KEYS = {
  AGENT: 'agent:',
  POLICIES: 'policies:',
};

// Pub/sub channels
const CHANNELS = {
  AGENT_EVENTS: 'agent:events',
  TRANSACTION_EVENTS: 'transaction:events',
  GLOBAL_EVENTS: 'global:events',
};

export interface GuthwineServiceConfig {
  enableSemanticFirewall?: boolean;
  enableRateLimiting?: boolean;
  masterKeySecret?: string;
}

export class GuthwineService {
  private config: GuthwineServiceConfig;
  private policyEngine: PolicyEngine;
  private semanticFirewall: SemanticFirewall;
  private delegationService: DelegationService;
  private paymentRails: PaymentRailService;
  private masterKey: Buffer | null = null;
  private signingKey: string = '';

  constructor(config: GuthwineServiceConfig = {}) {
    this.config = {
      enableSemanticFirewall: true,
      enableRateLimiting: true,
      ...config,
    };
    
    this.policyEngine = new PolicyEngine();
    this.semanticFirewall = new SemanticFirewall();
    this.delegationService = new DelegationService();
    this.paymentRails = new PaymentRailService();
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    const secret = this.config.masterKeySecret || process.env.GUTHWINE_MASTER_KEY || 'default-dev-key';
    const salt = process.env.GUTHWINE_MASTER_SALT || await generateSalt();
    this.masterKey = await deriveMasterKey(secret, salt);
    
    // Generate signing key for audit logs
    const keyPair = await generateKeyPair();
    this.signingKey = keyPair.privateKey;
    
    console.log('Guthwine service initialized');
  }

  // ==========================================================================
  // AGENT MANAGEMENT
  // ==========================================================================

  /**
   * Register a new agent
   */
  async registerAgent(input: {
    organizationId: string;
    name: string;
    type?: 'PRIMARY' | 'DELEGATED' | 'SERVICE' | 'EPHEMERAL';
    parentAgentId?: string;
    createdByUserId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    id: string;
    did: string;
    name: string;
    publicKey: string;
  }> {
    if (!this.masterKey) {
      throw new Error('Service not initialized');
    }

    const keyPair = await generateKeyPair();
    const did = generateDID(keyPair.publicKey);
    const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, this.masterKey);

    const agent = await prisma.agent.create({
      data: {
        id: uuidv4(),
        organizationId: input.organizationId,
        did,
        name: input.name,
        publicKey: keyPair.publicKey,
        encryptedPrivateKey,
        type: input.type || 'PRIMARY',
        status: 'ACTIVE',
        parentAgentId: input.parentAgentId || null,
        createdByUserId: input.createdByUserId,
        capabilities: {} as Prisma.InputJsonValue,
        spendingLimits: {} as Prisma.InputJsonValue,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        reputationScore: 100,
      },
    });

    await this.createAuditLog({
      organizationId: input.organizationId,
      agentId: agent.id,
      action: 'AGENT_CREATED',
      actorType: 'USER',
      actorId: input.createdByUserId,
      payload: { agentId: agent.id, name: agent.name, did },
    });

    await publish(CHANNELS.AGENT_EVENTS, JSON.stringify({
      type: 'agent.created',
      agentId: agent.id,
      timestamp: new Date().toISOString(),
    }));

    return {
      id: agent.id,
      did: agent.did,
      name: agent.name,
      publicKey: agent.publicKey,
    };
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<{
    id: string;
    did: string;
    name: string;
    status: string;
    type: string;
    publicKey: string;
    createdAt: Date;
  } | null> {
    const cached = await cacheGet<any>(`${CACHE_KEYS.AGENT}${agentId}`);
    if (cached) return cached;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (agent) {
      const result = {
        id: agent.id,
        did: agent.did,
        name: agent.name,
        status: agent.status,
        type: agent.type,
        publicKey: agent.publicKey,
        createdAt: agent.createdAt,
      };
      await cacheSet(`${CACHE_KEYS.AGENT}${agentId}`, result, 300);
      return result;
    }

    return null;
  }

  /**
   * Get agent by DID
   */
  async getAgentByDid(did: string): Promise<{
    id: string;
    did: string;
    name: string;
    status: string;
    type: string;
    organizationId: string;
  } | null> {
    const agent = await prisma.agent.findFirst({
      where: { did },
    });

    if (agent) {
      return {
        id: agent.id,
        did: agent.did,
        name: agent.name,
        status: agent.status,
        type: agent.type,
        organizationId: agent.organizationId,
      };
    }

    return null;
  }

  /**
   * Freeze an agent (kill switch)
   */
  async freezeAgent(
    agentId: string,
    reason: string,
    frozenByUserId: string
  ): Promise<void> {
    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: {
        status: 'FROZEN',
        frozenAt: new Date(),
        frozenById: frozenByUserId,
        frozenReason: reason,
      },
    });

    await cacheDelete(`${CACHE_KEYS.AGENT}${agentId}`);

    await this.createAuditLog({
      organizationId: agent.organizationId,
      agentId,
      action: 'AGENT_FROZEN',
      actorType: 'USER',
      actorId: frozenByUserId,
      payload: { reason },
    });

    await publish(CHANNELS.AGENT_EVENTS, JSON.stringify({
      type: 'agent.frozen',
      agentId,
      reason,
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Unfreeze an agent
   */
  async unfreezeAgent(agentId: string, unfrozenByUserId: string): Promise<void> {
    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: {
        status: 'ACTIVE',
        frozenAt: null,
        frozenById: null,
        frozenReason: null,
      },
    });

    await cacheDelete(`${CACHE_KEYS.AGENT}${agentId}`);

    await this.createAuditLog({
      organizationId: agent.organizationId,
      agentId,
      action: 'AGENT_UNFROZEN',
      actorType: 'USER',
      actorId: unfrozenByUserId,
      payload: {},
    });

    await publish(CHANNELS.AGENT_EVENTS, JSON.stringify({
      type: 'agent.unfrozen',
      agentId,
      timestamp: new Date().toISOString(),
    }));
  }

  // ==========================================================================
  // TRANSACTION AUTHORIZATION
  // ==========================================================================

  /**
   * Authorize a transaction
   */
  async authorizeTransaction(input: {
    organizationId: string;
    agentDid: string;
    amount: number;
    currency: string;
    merchantId: string;
    merchantName?: string;
    merchantCategory?: string;
    reasoningTrace?: string;
    delegationChain?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{
    transactionId: string;
    status: 'APPROVED' | 'DENIED' | 'REQUIRES_REVIEW';
    decision: string;
    reason: string;
    mandateToken?: string;
    mandateExpiresAt?: Date;
    riskScore: number;
    policyViolations: string[];
  }> {
    const startTime = Date.now();

    const agent = await this.getAgentByDid(input.agentDid);
    if (!agent) {
      throw new Error(`Agent not found: ${input.agentDid}`);
    }

    if (agent.status === 'FROZEN') {
      return {
        transactionId: uuidv4(),
        status: 'DENIED',
        decision: 'Agent is frozen',
        reason: 'Agent has been frozen and cannot perform transactions',
        riskScore: 100,
        policyViolations: ['AGENT_FROZEN'],
      };
    }

    const transactionId = uuidv4();
    await prisma.transactionRequest.create({
      data: {
        id: transactionId,
        organizationId: input.organizationId,
        agentId: agent.id,
        agentDid: input.agentDid,
        type: 'PAYMENT',
        amount: input.amount,
        currency: input.currency,
        merchant: {
          id: input.merchantId,
          name: input.merchantName || null,
          category: input.merchantCategory || null,
        },
        description: null,
        reasoningTrace: input.reasoningTrace || null,
        status: 'PENDING',
        riskScore: 0,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      },
    });

    const policyResult = await this.policyEngine.evaluatePolicies(
      agent.id,
      input.organizationId,
      {
        amount: input.amount,
        currency: input.currency,
        merchantId: input.merchantId,
        merchantCategory: input.merchantCategory,
        timestamp: new Date(),
      }
    );

    let semanticResult = null;
    if (this.config.enableSemanticFirewall && input.reasoningTrace) {
      semanticResult = await this.semanticFirewall.evaluate({
        reasoningTrace: input.reasoningTrace,
        amount: input.amount,
        currency: input.currency,
        merchantName: input.merchantName || input.merchantId,
        agentName: agent.name,
      });
    }

    const riskScore = this.calculateRiskScore(policyResult, semanticResult);

    let status: 'APPROVED' | 'DENIED' | 'REQUIRES_REVIEW' = 'APPROVED';
    let reason = 'Transaction approved';
    const policyViolations: string[] = [];

    if (policyResult.denied) {
      status = 'DENIED';
      reason = policyResult.reason || 'Policy violation';
      policyViolations.push(...(policyResult.violations || []));
    } else if (riskScore > 80) {
      status = 'REQUIRES_REVIEW';
      reason = 'High risk score requires manual review';
    } else if (semanticResult && !semanticResult.compliant) {
      status = 'DENIED';
      reason = semanticResult.reasoning || 'Semantic policy violation';
      policyViolations.push('SEMANTIC_VIOLATION');
    }

    let mandateToken: string | undefined;
    let mandateExpiresAt: Date | undefined;
    if (status === 'APPROVED') {
      mandateToken = await this.generateMandateToken(transactionId, agent.id, input);
      mandateExpiresAt = new Date(Date.now() + 3600000);
    }

    await prisma.transactionRequest.update({
      where: { id: transactionId },
      data: {
        status,
        riskScore,
        mandateToken: mandateToken || null,
        mandateExpiresAt: mandateExpiresAt || null,
        decidedAt: new Date(),
        policyEvaluation: policyResult as any,
      },
    });

    await this.createAuditLog({
      organizationId: input.organizationId,
      agentId: agent.id,
      transactionId,
      action: status === 'APPROVED' ? 'TRANSACTION_APPROVED' : 'TRANSACTION_DENIED',
      actorType: 'AGENT',
      actorId: agent.id,
      actorDid: agent.did,
      payload: {
        amount: input.amount,
        currency: input.currency,
        merchantId: input.merchantId,
        riskScore,
        reason,
        evaluationTimeMs: Date.now() - startTime,
      },
    });

    await publish(CHANNELS.TRANSACTION_EVENTS, JSON.stringify({
      type: status === 'APPROVED' ? 'transaction.approved' : 'transaction.denied',
      transactionId,
      agentId: agent.id,
      amount: input.amount,
      timestamp: new Date().toISOString(),
    }));

    return {
      transactionId,
      status,
      decision: status,
      reason,
      mandateToken,
      mandateExpiresAt,
      riskScore,
      policyViolations,
    };
  }

  /**
   * Execute an approved transaction
   */
  async executeTransaction(input: {
    transactionId: string;
    mandateToken: string;
    paymentRail: 'STRIPE' | 'COINBASE' | 'WISE' | 'PLAID' | 'WEBHOOK' | 'MANUAL';
    railParams?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    railTransactionId?: string;
    error?: string;
  }> {
    const transaction = await prisma.transactionRequest.findUnique({
      where: { id: input.transactionId },
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== 'APPROVED') {
      throw new Error('Transaction is not approved');
    }

    if (transaction.mandateToken !== input.mandateToken) {
      throw new Error('Invalid mandate token');
    }

    try {
      const result = await this.paymentRails.execute({
        rail: input.paymentRail,
        amount: transaction.amount,
        currency: transaction.currency,
        merchantId: (transaction.merchant as any)?.id || 'unknown',
        metadata: {
          transactionId: input.transactionId,
          ...(input.railParams || {}),
        },
      });

      await prisma.transactionRequest.update({
        where: { id: input.transactionId },
        data: {
          status: 'EXECUTED',
          paymentRail: input.paymentRail,
          paymentRailTransactionId: result.railTransactionId,
          executedAt: new Date(),
        },
      });

      await this.createAuditLog({
        organizationId: transaction.organizationId,
        agentId: transaction.agentId,
        transactionId: input.transactionId,
        action: 'TRANSACTION_EXECUTED',
        actorType: 'SYSTEM',
        payload: {
          paymentRail: input.paymentRail,
          railTransactionId: result.railTransactionId,
        },
      });

      return {
        success: true,
        railTransactionId: result.railTransactionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await prisma.transactionRequest.update({
        where: { id: input.transactionId },
        data: {
          status: 'FAILED',
          executionError: errorMessage,
        },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ==========================================================================
  // POLICIES
  // ==========================================================================

  /**
   * Add a policy and assign it to an agent
   */
  async addPolicy(input: {
    organizationId: string;
    agentId: string;
    name: string;
    description?: string;
    rules: Record<string, unknown>;
    priority?: number;
    createdByUserId: string;
  }): Promise<{ id: string; name: string }> {
    const policy = await prisma.policy.create({
      data: {
        id: uuidv4(),
        organizationId: input.organizationId,
        name: input.name,
        description: input.description || null,
        type: 'SPENDING',
        scope: 'AGENT',
        rules: input.rules as Prisma.InputJsonValue,
        action: 'DENY',
        priority: input.priority || 100,
        isActive: true,
        createdById: input.createdByUserId,
      },
    });

    // Create policy assignment
    await prisma.policyAssignment.create({
      data: {
        id: uuidv4(),
        policyId: policy.id,
        agentId: input.agentId,
        assignedById: input.createdByUserId,
      },
    });

    await cacheDelete(`${CACHE_KEYS.POLICIES}${input.agentId}`);

    return { id: policy.id, name: policy.name };
  }

  /**
   * Get policies for an agent
   */
  async getPolicies(agentId: string): Promise<Array<{
    id: string;
    name: string;
    description: string | null;
    rules: Record<string, unknown>;
    priority: number;
    isActive: boolean;
  }>> {
    const assignments = await prisma.policyAssignment.findMany({
      where: { agentId },
      include: { policy: true },
    });

    return assignments.map(a => ({
      id: a.policy.id,
      name: a.policy.name,
      description: a.policy.description,
      rules: a.policy.rules as Record<string, unknown>,
      priority: a.overridePriority || a.policy.priority,
      isActive: a.policy.isActive,
    }));
  }

  // ==========================================================================
  // DELEGATIONS
  // ==========================================================================

  /**
   * Issue a delegation
   */
  async issueDelegation(input: {
    organizationId: string;
    issuerAgentId: string;
    recipientAgentId: string;
    constraints: {
      maxAmount?: number;
      allowedMerchants?: string[];
      blockedMerchants?: string[];
      allowedCategories?: string[];
      semanticConstraints?: string;
      expiresInSeconds?: number;
    };
    issuedByUserId: string;
  }): Promise<{
    id: string;
    token: string;
    expiresAt: Date;
  }> {
    return this.delegationService.issueDelegation(input);
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(
    delegationId: string,
    reason: string,
    revokedByUserId: string
  ): Promise<void> {
    return this.delegationService.revokeDelegation(delegationId, reason, revokedByUserId);
  }

  // ==========================================================================
  // GLOBAL CONTROLS
  // ==========================================================================

  /**
   * Set global freeze - freezes all agents in an organization
   */
  async setGlobalFreeze(
    organizationId: string,
    active: boolean,
    reason: string,
    setByUserId: string
  ): Promise<void> {
    if (active) {
      // Freeze all agents
      await prisma.agent.updateMany({
        where: { organizationId },
        data: {
          status: 'FROZEN',
          frozenAt: new Date(),
          frozenById: setByUserId,
          frozenReason: reason,
        },
      });
    } else {
      // Unfreeze all agents
      await prisma.agent.updateMany({
        where: { organizationId, status: 'FROZEN' },
        data: {
          status: 'ACTIVE',
          frozenAt: null,
          frozenById: null,
          frozenReason: null,
        },
      });
    }

    await this.createAuditLog({
      organizationId,
      action: active ? 'GLOBAL_FREEZE_ACTIVATED' : 'GLOBAL_FREEZE_DEACTIVATED',
      actorType: 'USER',
      actorId: setByUserId,
      payload: { reason },
    });

    await publish(CHANNELS.GLOBAL_EVENTS, JSON.stringify({
      type: active ? 'global.freeze' : 'global.unfreeze',
      reason,
      timestamp: new Date().toISOString(),
    }));
  }

  // ==========================================================================
  // AUDIT
  // ==========================================================================

  /**
   * Get audit trail
   */
  async getAuditTrail(input: {
    organizationId: string;
    agentId?: string;
    transactionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<{
    id: string;
    action: string;
    payload: Record<string, unknown>;
    timestamp: Date;
  }>> {
    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.agentId && { agentId: input.agentId }),
        ...(input.transactionId && { transactionId: input.transactionId }),
      },
      orderBy: { timestamp: 'desc' },
      take: input.limit || 50,
      skip: input.offset || 0,
    });

    return logs.map(log => ({
      id: log.id,
      action: log.action,
      payload: log.payload as Record<string, unknown>,
      timestamp: log.timestamp,
    }));
  }

  /**
   * Verify audit integrity
   */
  async verifyAuditIntegrity(organizationId: string): Promise<{
    valid: boolean;
    totalLogs: number;
    verifiedLogs: number;
    errors: string[];
  }> {
    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { sequenceNumber: 'asc' },
    });

    const errors: string[] = [];
    let verifiedLogs = 0;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (!log) continue;
      
      // Verify hash chain
      if (i > 0) {
        const prevLog = logs[i - 1];
        if (prevLog && log.previousHash !== prevLog.entryHash) {
          errors.push(`Hash chain broken at sequence ${log.sequenceNumber}`);
          continue;
        }
      }

      // Verify current hash
      const dataToHash = JSON.stringify({
        id: log.id,
        action: log.action,
        payload: log.payload,
        previousHash: log.previousHash,
        sequenceNumber: log.sequenceNumber,
      });
      const expectedHash = hash(dataToHash);
      
      if (log.entryHash !== expectedHash) {
        errors.push(`Hash mismatch at sequence ${log.sequenceNumber}`);
        continue;
      }

      verifiedLogs++;
    }

    return {
      valid: errors.length === 0,
      totalLogs: logs.length,
      verifiedLogs,
      errors,
    };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async createAuditLog(input: {
    organizationId: string;
    agentId?: string;
    transactionId?: string;
    action: string;
    actorType: 'USER' | 'AGENT' | 'SYSTEM' | 'API_KEY';
    actorId?: string;
    actorDid?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    // Get last audit log for hash chain
    const lastLog = await prisma.auditLog.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { sequenceNumber: 'desc' },
    });

    const sequenceNumber = (lastLog?.sequenceNumber || 0) + 1;
    const previousHash = lastLog?.entryHash || '0'.repeat(64);

    const id = uuidv4();
    const dataToHash = JSON.stringify({
      id,
      action: input.action,
      payload: input.payload,
      previousHash,
      sequenceNumber,
    });
    const entryHash = hash(dataToHash);
    const signature = sign(entryHash, this.signingKey);

    // Retain for 7 years (compliance)
    const retainUntil = new Date();
    retainUntil.setFullYear(retainUntil.getFullYear() + 7);

    await prisma.auditLog.create({
      data: {
        id,
        organizationId: input.organizationId,
        agentId: input.agentId || null,
        transactionId: input.transactionId || null,
        action: input.action,
        actorType: input.actorType,
        actorId: input.actorId || null,
        actorDid: input.actorDid || null,
        payload: input.payload as Prisma.InputJsonValue,
        previousHash,
        entryHash,
        signature,
        sequenceNumber,
        severity: 'INFO',
        retainUntil,
      },
    });
  }

  private calculateRiskScore(
    policyResult: any,
    semanticResult: any
  ): number {
    let score = 0;

    if (policyResult.denied) {
      score += 50;
    } else if (policyResult.flagged) {
      score += 25;
    }

    if (semanticResult) {
      if (!semanticResult.compliant) {
        score += 40;
      } else if (semanticResult.confidence && semanticResult.confidence < 0.7) {
        score += 20;
      }
    }

    return Math.min(100, score);
  }

  private async generateMandateToken(
    transactionId: string,
    agentId: string,
    input: any
  ): Promise<string> {
    const payload = {
      transactionId,
      agentId,
      amount: input.amount,
      currency: input.currency,
      merchantId: input.merchantId,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
    
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}

export const guthwineService = new GuthwineService();
