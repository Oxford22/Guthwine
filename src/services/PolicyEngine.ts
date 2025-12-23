/**
 * Guthwine - Policy Engine
 * Evaluates transaction requests against JSON Logic rules and semantic constraints
 */

import { PrismaClient } from '@prisma/client';
import jsonLogic from 'json-logic-js';
import OpenAI from 'openai';
import type { 
  TransactionRequest, 
  PolicyEvaluationResult,
  DelegationConstraints 
} from '../types/index.js';

export class PolicyEngine {
  private prisma: PrismaClient;
  private openai: OpenAI;
  private semanticCheckEnabled: boolean;

  constructor(prisma: PrismaClient, enableSemanticCheck: boolean = true) {
    this.prisma = prisma;
    this.openai = new OpenAI();
    this.semanticCheckEnabled = enableSemanticCheck;
  }

  /**
   * Evaluate a transaction against all applicable policies
   */
  async evaluateTransaction(
    agentDid: string,
    transaction: TransactionRequest,
    delegationConstraints?: DelegationConstraints
  ): Promise<PolicyEvaluationResult> {
    const violations: string[] = [];
    const matchedPolicies: string[] = [];

    // Get agent with policies
    const agent = await this.prisma.agent.findUnique({
      where: { did: agentDid },
    });

    if (!agent) {
      return {
        allowed: false,
        violations: ['Agent not found'],
        matchedPolicies: [],
      };
    }

    // Check if agent is frozen
    if (agent.isFrozen) {
      return {
        allowed: false,
        violations: ['Agent is frozen'],
        matchedPolicies: [],
      };
    }

    // Get policies for agent
    const policies = await this.prisma.policy.findMany({
      where: { agentDid, isActive: true },
      orderBy: { priority: 'desc' },
    });

    // Build the data context for JSON Logic evaluation
    const context = {
      amount: transaction.amount,
      currency: transaction.currency,
      merchantId: transaction.merchantId,
      merchantName: transaction.merchantName,
      merchantCategory: transaction.merchantCategory,
      reasoningTrace: transaction.reasoningTrace,
      metadata: transaction.metadata || {},
      timestamp: Date.now(),
      dayOfWeek: new Date().getDay(),
      hour: new Date().getHours(),
    };

    // Evaluate each policy
    for (const policy of policies) {
      try {
        const rules = JSON.parse(policy.rules);
        const result = jsonLogic.apply(rules, context);
        
        if (!result) {
          violations.push(`Policy "${policy.name}" denied: ${policy.description || 'No description'}`);
          matchedPolicies.push(policy.id);
        }
      } catch (error) {
        console.error(`Error evaluating policy ${policy.id}:`, error);
        violations.push(`Policy "${policy.name}" evaluation error`);
      }
    }

    // Check delegation constraints if provided
    if (delegationConstraints) {
      const constraintViolations = this.checkDelegationConstraints(
        delegationConstraints,
        transaction
      );
      violations.push(...constraintViolations);
    }

    // Perform semantic check if enabled and there are semantic constraints
    let semanticCheckResult: PolicyEvaluationResult['semanticCheckResult'];
    
    if (this.semanticCheckEnabled) {
      const semanticConstraints = this.collectSemanticConstraints(
        policies,
        delegationConstraints
      );

      if (semanticConstraints.length > 0) {
        semanticCheckResult = await this.performSemanticCheck(
          transaction,
          semanticConstraints
        );

        if (!semanticCheckResult.passed) {
          violations.push(`Semantic constraint violation: ${semanticCheckResult.reason}`);
        }
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      matchedPolicies,
      semanticCheckResult,
    };
  }

  /**
   * Check delegation constraints against transaction
   */
  private checkDelegationConstraints(
    constraints: DelegationConstraints,
    transaction: TransactionRequest
  ): string[] {
    const violations: string[] = [];

    // Check amount
    if (constraints.maxAmount !== undefined && transaction.amount > constraints.maxAmount) {
      violations.push(
        `Transaction amount ${transaction.amount} exceeds delegation limit ${constraints.maxAmount}`
      );
    }

    // Check currency
    if (constraints.currency && constraints.currency !== transaction.currency) {
      violations.push(
        `Currency ${transaction.currency} not allowed by delegation (expected ${constraints.currency})`
      );
    }

    // Check allowed merchants
    if (constraints.allowedMerchants && constraints.allowedMerchants.length > 0) {
      if (!constraints.allowedMerchants.includes(transaction.merchantId)) {
        violations.push(
          `Merchant ${transaction.merchantId} not in allowed list`
        );
      }
    }

    // Check allowed categories
    if (constraints.allowedCategories && constraints.allowedCategories.length > 0) {
      if (transaction.merchantCategory && 
          !constraints.allowedCategories.includes(transaction.merchantCategory)) {
        violations.push(
          `Category ${transaction.merchantCategory} not in allowed list`
        );
      }
    }

    return violations;
  }

  /**
   * Collect all semantic constraints from policies and delegation
   */
  private collectSemanticConstraints(
    policies: { semanticConstraints: string | null }[],
    delegationConstraints?: DelegationConstraints
  ): string[] {
    const constraints: string[] = [];

    for (const policy of policies) {
      if (policy.semanticConstraints) {
        constraints.push(policy.semanticConstraints);
      }
    }

    if (delegationConstraints?.semanticConstraints) {
      constraints.push(delegationConstraints.semanticConstraints);
    }

    return constraints;
  }

  /**
   * Perform semantic check using LLM
   */
  async performSemanticCheck(
    transaction: TransactionRequest,
    semanticConstraints: string[]
  ): Promise<{ passed: boolean; reason: string; confidence: number }> {
    const constraintsText = semanticConstraints.join('\n- ');
    
    const prompt = `You are a financial compliance AI evaluating whether a transaction request complies with semantic constraints.

TRANSACTION DETAILS:
- Amount: ${transaction.amount} ${transaction.currency}
- Merchant ID: ${transaction.merchantId}
- Merchant Name: ${transaction.merchantName || 'Unknown'}
- Merchant Category: ${transaction.merchantCategory || 'Unknown'}
- Agent's Reasoning: "${transaction.reasoningTrace}"
- Additional Metadata: ${JSON.stringify(transaction.metadata || {})}

SEMANTIC CONSTRAINTS:
- ${constraintsText}

TASK:
Evaluate whether this transaction complies with ALL semantic constraints.
Consider the agent's reasoning and whether it aligns with the stated purpose.

Respond in JSON format:
{
  "passed": true/false,
  "reason": "Brief explanation of your decision",
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { passed: false, reason: 'LLM returned empty response', confidence: 0 };
      }

      const result = JSON.parse(content);
      return {
        passed: Boolean(result.passed),
        reason: String(result.reason || 'No reason provided'),
        confidence: Number(result.confidence) || 0.5,
      };
    } catch (error) {
      console.error('Semantic check error:', error);
      // Fail closed on error
      return {
        passed: false,
        reason: 'Semantic check failed due to error',
        confidence: 0,
      };
    }
  }

  /**
   * Add a new policy for an agent
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
    // Validate JSON Logic rules
    try {
      jsonLogic.apply(rules, { amount: 100, currency: 'USD' });
    } catch (error) {
      throw new Error(`Invalid JSON Logic rules: ${error}`);
    }

    const policy = await this.prisma.policy.create({
      data: {
        agentDid,
        name,
        description: options?.description,
        rules: JSON.stringify(rules),
        semanticConstraints: options?.semanticConstraints,
        priority: options?.priority || 0,
        isActive: true,
      },
    });

    return policy.id;
  }

  /**
   * Update an existing policy
   */
  async updatePolicy(
    policyId: string,
    updates: {
      name?: string;
      rules?: any;
      description?: string;
      semanticConstraints?: string;
      priority?: number;
      isActive?: boolean;
    }
  ): Promise<void> {
    const data: any = {};

    if (updates.name !== undefined) data.name = updates.name;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.semanticConstraints !== undefined) data.semanticConstraints = updates.semanticConstraints;
    if (updates.priority !== undefined) data.priority = updates.priority;
    if (updates.isActive !== undefined) data.isActive = updates.isActive;
    
    if (updates.rules !== undefined) {
      // Validate JSON Logic rules
      try {
        jsonLogic.apply(updates.rules, { amount: 100, currency: 'USD' });
      } catch (error) {
        throw new Error(`Invalid JSON Logic rules: ${error}`);
      }
      data.rules = JSON.stringify(updates.rules);
    }

    await this.prisma.policy.update({
      where: { id: policyId },
      data,
    });
  }

  /**
   * Delete a policy
   */
  async deletePolicy(policyId: string): Promise<void> {
    await this.prisma.policy.delete({
      where: { id: policyId },
    });
  }

  /**
   * Get all policies for an agent
   */
  async getPolicies(agentDid: string): Promise<any[]> {
    const policies = await this.prisma.policy.findMany({
      where: { agentDid },
    });

    return policies.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      rules: JSON.parse(p.rules),
      semanticConstraints: p.semanticConstraints,
      priority: p.priority,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Create a snapshot of current policies for audit
   */
  async createPolicySnapshot(agentDid: string): Promise<{ id: string; snapshot: string }> {
    const policies = await this.getPolicies(agentDid);
    const snapshot = JSON.stringify(policies);
    
    const policySnapshot = await this.prisma.policySnapshot.create({
      data: {
        agentDid,
        policies: snapshot,
      },
    });
    
    return { id: policySnapshot.id, snapshot };
  }

  /**
   * Common policy templates
   */
  static readonly POLICY_TEMPLATES = {
    // Maximum transaction amount
    maxAmount: (limit: number) => ({
      '<=': [{ var: 'amount' }, limit],
    }),

    // Allowed currencies
    allowedCurrencies: (currencies: string[]) => ({
      in: [{ var: 'currency' }, currencies],
    }),

    // Allowed merchants
    allowedMerchants: (merchantIds: string[]) => ({
      in: [{ var: 'merchantId' }, merchantIds],
    }),

    // Blocked merchants
    blockedMerchants: (merchantIds: string[]) => ({
      '!': { in: [{ var: 'merchantId' }, merchantIds] },
    }),

    // Allowed categories
    allowedCategories: (categories: string[]) => ({
      in: [{ var: 'merchantCategory' }, categories],
    }),

    // Business hours only (9 AM - 5 PM, Monday-Friday)
    businessHoursOnly: () => ({
      and: [
        { '>=': [{ var: 'hour' }, 9] },
        { '<=': [{ var: 'hour' }, 17] },
        { '>=': [{ var: 'dayOfWeek' }, 1] },
        { '<=': [{ var: 'dayOfWeek' }, 5] },
      ],
    }),

    // Combined: max amount AND allowed categories
    maxAmountWithCategories: (limit: number, categories: string[]) => ({
      and: [
        { '<=': [{ var: 'amount' }, limit] },
        { in: [{ var: 'merchantCategory' }, categories] },
      ],
    }),

    // Require reasoning trace to contain certain keywords
    requireReasoningKeywords: (keywords: string[]) => ({
      some: [
        keywords,
        { in: [{ var: '' }, { var: 'reasoningTrace' }] },
      ],
    }),
  };
}
