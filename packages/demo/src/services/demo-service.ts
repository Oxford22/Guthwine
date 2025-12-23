/**
 * Demo Service - Main Orchestrator for Zero-Dependency Demo
 * 
 * Provides a simplified interface to the Guthwine authorization system
 * using SQLite for storage and in-memory mocks for Redis/LLM.
 */

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import jsonLogic from 'json-logic-js';
import { SqliteAdapter, Agent, Policy, Transaction, AuditLog, Organization } from '../adapters/sqlite-adapter.js';
import { MockRedisAdapter } from '../adapters/mock-redis-adapter.js';
import { MockLLMService, SemanticAnalysisResult } from './mock-llm.js';

export interface AuthorizationRequest {
  agentId?: string;
  agentDid?: string;
  action: string;
  amount?: number;
  currency?: string;
  merchantId?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface AuthorizationResult {
  approved: boolean;
  transactionId: string;
  mandateToken?: string;
  denialReason?: string;
  policyEvaluation: {
    policiesEvaluated: number;
    matchedPolicies: string[];
    semanticAnalysis?: SemanticAnalysisResult;
  };
  riskScore: number;
}

export interface DemoServiceConfig {
  dbPath?: string;
  enableSemanticFirewall?: boolean;
  llmLatencyMs?: number;
  rateLimitPerMinute?: number;
  defaultBudgetLimit?: number;
}

export class DemoService {
  private db: SqliteAdapter;
  private redis: MockRedisAdapter;
  private llm: MockLLMService;
  private config: {
    dbPath?: string;
    enableSemanticFirewall: boolean;
    llmLatencyMs: number;
    rateLimitPerMinute: number;
    defaultBudgetLimit: number;
  };

  constructor(config: DemoServiceConfig = {}) {
    this.config = {
      dbPath: config.dbPath ?? undefined,
      enableSemanticFirewall: config.enableSemanticFirewall ?? true,
      llmLatencyMs: config.llmLatencyMs ?? 800,
      rateLimitPerMinute: config.rateLimitPerMinute ?? 60,
      defaultBudgetLimit: config.defaultBudgetLimit ?? 10000
    };

    this.db = new SqliteAdapter(this.config.dbPath);
    this.redis = new MockRedisAdapter();
    this.llm = new MockLLMService({ latencyMs: this.config.llmLatencyMs });
  }

  // Authorization - The Core Function
  async authorize(request: AuthorizationRequest): Promise<AuthorizationResult> {
    // Get agent
    const agent = request.agentDid 
      ? this.db.getAgentByDid(request.agentDid)
      : request.agentId 
        ? this.db.getAgent(request.agentId)
        : null;

    if (!agent) {
      throw new Error(`Agent not found: ${request.agentDid || request.agentId}`);
    }

    // Check if agent is frozen
    if (agent.status === 'FROZEN') {
      return this.createDenialResult(agent, request, 'Agent is frozen');
    }

    // Check organization freeze
    const org = this.db.getOrganization(agent.organizationId);
    if (org?.globalFreeze) {
      return this.createDenialResult(agent, request, 'Organization is frozen');
    }

    // Rate limiting
    const rateLimit = await this.redis.checkRateLimit(
      `agent:${agent.id}`,
      this.config.rateLimitPerMinute,
      60
    );
    if (!rateLimit.allowed) {
      return this.createDenialResult(agent, request, 'Rate limit exceeded');
    }

    // Budget check
    if (request.amount) {
      const period = this.getCurrentBudgetPeriod();
      const budgetCheck = await this.redis.decrementBudget(
        agent.id,
        period,
        request.amount,
        this.config.defaultBudgetLimit
      );
      if (!budgetCheck.success) {
        return this.createDenialResult(agent, request, `Budget exceeded. Remaining: ${budgetCheck.remaining}`);
      }
    }

    // Policy evaluation
    const policies = this.db.listPolicies(agent.organizationId);
    const agentPolicies = this.db.getAgentPolicies(agent.id);
    const allPolicies = [...policies, ...agentPolicies];
    
    const context = {
      agent: {
        id: agent.id,
        did: agent.did,
        name: agent.name,
        status: agent.status
      },
      transaction: {
        action: request.action,
        amount: request.amount,
        currency: request.currency,
        merchantId: request.merchantId,
        reason: request.reason
      },
      timestamp: new Date().toISOString()
    };

    const matchedPolicies: string[] = [];
    let policyDenied = false;
    let policyDenialReason = '';

    for (const policy of allPolicies.sort((a, b) => b.priority - a.priority)) {
      try {
        const result = jsonLogic.apply(policy.rules, context);
        if (result) {
          matchedPolicies.push(policy.name);
          if (policy.effect === 'DENY') {
            policyDenied = true;
            policyDenialReason = `Policy "${policy.name}" denied the transaction`;
            break;
          }
        }
      } catch {
        // Skip invalid policies
      }
    }

    if (policyDenied) {
      return this.createDenialResult(agent, request, policyDenialReason, matchedPolicies);
    }

    // Semantic firewall
    let semanticAnalysis: SemanticAnalysisResult | undefined;
    if (this.config.enableSemanticFirewall) {
      semanticAnalysis = await this.llm.analyze({
        action: request.action,
        reason: request.reason,
        amount: request.amount,
        currency: request.currency,
        merchantId: request.merchantId
      });

      if (!semanticAnalysis.approved) {
        return this.createDenialResult(
          agent,
          request,
          semanticAnalysis.reasoning,
          matchedPolicies,
          semanticAnalysis
        );
      }
    }

    // All checks passed - create mandate token
    const transactionId = randomUUID();
    const mandateToken = this.createMandateToken(agent, request, transactionId);

    // Record transaction
    this.db.createTransaction({
      id: transactionId,
      agentId: agent.id,
      organizationId: agent.organizationId,
      type: 'authorization',
      action: request.action,
      amount: request.amount,
      currency: request.currency,
      status: 'APPROVED',
      reason: request.reason,
      policyEvaluation: {
        policiesEvaluated: allPolicies.length,
        matchedPolicies,
        semanticAnalysis
      },
      mandateToken
    });

    // Audit log
    this.createAuditLog(agent, 'TRANSACTION_APPROVED', 'transaction', transactionId, {
      action: request.action,
      amount: request.amount,
      currency: request.currency,
      riskScore: semanticAnalysis?.riskScore || 0
    });

    // Publish event
    await this.redis.publish('transactions', JSON.stringify({
      type: 'APPROVED',
      transactionId,
      agentId: agent.id,
      timestamp: new Date().toISOString()
    }));

    return {
      approved: true,
      transactionId,
      mandateToken,
      policyEvaluation: {
        policiesEvaluated: allPolicies.length,
        matchedPolicies,
        semanticAnalysis
      },
      riskScore: semanticAnalysis?.riskScore || 0
    };
  }

  private createDenialResult(
    agent: Agent,
    request: AuthorizationRequest,
    reason: string,
    matchedPolicies: string[] = [],
    semanticAnalysis?: SemanticAnalysisResult
  ): AuthorizationResult {
    const transactionId = randomUUID();

    // Record denied transaction
    this.db.createTransaction({
      id: transactionId,
      agentId: agent.id,
      organizationId: agent.organizationId,
      type: 'authorization',
      action: request.action,
      amount: request.amount,
      currency: request.currency,
      status: 'DENIED',
      reason: request.reason,
      policyEvaluation: {
        denialReason: reason,
        matchedPolicies,
        semanticAnalysis
      }
    });

    // Audit log
    this.createAuditLog(agent, 'TRANSACTION_DENIED', 'transaction', transactionId, {
      action: request.action,
      amount: request.amount,
      denialReason: reason
    });

    return {
      approved: false,
      transactionId,
      denialReason: reason,
      policyEvaluation: {
        policiesEvaluated: matchedPolicies.length,
        matchedPolicies,
        semanticAnalysis
      },
      riskScore: semanticAnalysis?.riskScore || 100
    };
  }

  private createMandateToken(agent: Agent, request: AuthorizationRequest, transactionId: string): string {
    const payload = {
      iss: 'guthwine-demo',
      sub: agent.did,
      txn: transactionId,
      act: request.action,
      amt: request.amount,
      cur: request.currency,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5 minute expiry
      nonce: randomUUID()
    };

    // Simple base64 encoding for demo (production would use proper JWT)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHash('sha256').update(`${header}.${body}`).digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  private createAuditLog(
    agent: Agent,
    action: string,
    resource: string,
    resourceId: string,
    payload: Record<string, unknown>
  ): void {
    const entryHash = createHash('sha256')
      .update(JSON.stringify({ agent: agent.id, action, resource, resourceId, payload, timestamp: Date.now() }))
      .digest('hex');

    this.db.createAuditLog({
      organizationId: agent.organizationId,
      agentId: agent.id,
      action,
      resource,
      resourceId,
      payload,
      entryHash
    });
  }

  private getCurrentBudgetPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Agent Management
  createAgent(data: Partial<Agent> & { organizationId: string; name: string }): Agent {
    const agent = this.db.createAgent({
      ...data,
      did: data.did || `did:guthwine:${randomUUID()}`,
      publicKey: data.publicKey || createHash('sha256').update(randomUUID()).digest('hex')
    });

    this.createAuditLog(agent, 'AGENT_CREATED', 'agent', agent.id, { name: agent.name });
    return agent;
  }

  getAgent(idOrDid: string): Agent | null {
    return this.db.getAgent(idOrDid) || this.db.getAgentByDid(idOrDid);
  }

  listAgents(organizationId: string): Agent[] {
    return this.db.listAgents(organizationId);
  }

  freezeAgent(agentId: string): Agent | null {
    const agent = this.db.updateAgent(agentId, { status: 'FROZEN' });
    if (agent) {
      this.createAuditLog(agent, 'AGENT_FROZEN', 'agent', agent.id, {});
    }
    return agent;
  }

  unfreezeAgent(agentId: string): Agent | null {
    const agent = this.db.updateAgent(agentId, { status: 'ACTIVE' });
    if (agent) {
      this.createAuditLog(agent, 'AGENT_UNFROZEN', 'agent', agent.id, {});
    }
    return agent;
  }

  // Organization Management
  createOrganization(data: Partial<Organization> & { name: string }): Organization {
    return this.db.createOrganization({
      ...data,
      slug: data.slug || data.name.toLowerCase().replace(/\s+/g, '-')
    });
  }

  getOrganization(id: string): Organization | null {
    return this.db.getOrganization(id);
  }

  // Policy Management
  createPolicy(data: Partial<Policy> & { organizationId: string; name: string; rules: Record<string, unknown> }): Policy {
    return this.db.createPolicy(data);
  }

  listPolicies(organizationId: string): Policy[] {
    return this.db.listPolicies(organizationId);
  }

  assignPolicyToAgent(policyId: string, agentId: string): void {
    this.db.assignPolicy(policyId, agentId);
  }

  // Transaction History
  listTransactions(agentId: string, limit?: number): Transaction[] {
    return this.db.listTransactions(agentId, limit);
  }

  // Audit Trail
  listAuditLogs(organizationId: string, limit?: number): AuditLog[] {
    return this.db.listAuditLogs(organizationId, limit);
  }

  // Event Subscription
  async subscribeToEvents(channel: string, handler: (message: string) => void): Promise<void> {
    await this.redis.subscribe(channel, handler);
  }

  // Stats
  getStats(): { db: ReturnType<SqliteAdapter['getStats']>; redis: Promise<{ keys: number; memory: string }> } {
    return {
      db: this.db.getStats(),
      redis: this.redis.getStats()
    };
  }

  // Cleanup
  close(): void {
    this.db.close();
    this.redis.close();
  }

  reset(): void {
    this.db.reset();
    this.redis.flushAll();
  }
}

export default DemoService;
