/**
 * Policy Engine v2
 * 
 * Enhanced policy engine with:
 * - Policy inheritance (org → team → agent hierarchy)
 * - Policy versioning with diff viewer
 * - Policy simulation mode (dry-run)
 * - Policy templates library
 */

import { prisma, Policy, Prisma } from '@guthwine/database';
import jsonLogic from 'json-logic-js';

// =============================================================================
// TYPES
// =============================================================================

export interface PolicyScope {
  organizationId: string;
  teamId?: string;
  agentId?: string;
}

export interface PolicyVersion {
  version: number;
  rules: Record<string, unknown>;
  createdAt: Date;
  createdBy: string;
  changeDescription: string;
}

export interface PolicyDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  type: 'added' | 'removed' | 'changed';
}

export interface PolicySimulationRequest {
  policyId?: string;
  rules?: Record<string, unknown>;
  context: Record<string, unknown>;
  agentId?: string;
  organizationId: string;
}

export interface PolicySimulationResult {
  wouldAllow: boolean;
  matchedPolicies: Array<{
    policyId: string;
    name: string;
    result: boolean;
    action: string;
  }>;
  evaluationTrace: Array<{
    policyId: string;
    rule: Record<string, unknown>;
    context: Record<string, unknown>;
    result: boolean;
  }>;
  warnings: string[];
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  rules: Record<string, unknown>;
  parameters: Array<{
    name: string;
    type: 'number' | 'string' | 'boolean' | 'array';
    description: string;
    default?: unknown;
    required: boolean;
  }>;
  examples: Array<{
    name: string;
    parameters: Record<string, unknown>;
    description: string;
  }>;
}

export interface EvaluationContext {
  // Transaction details
  amount?: number;
  currency?: string;
  merchantCategory?: string;
  merchantId?: string;
  merchantName?: string;
  merchantCountry?: string;
  
  // Time context
  timestamp?: number;
  hour?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  month?: number;
  year?: number;
  
  // Agent context
  agentId?: string;
  agentType?: string;
  agentReputationScore?: number;
  
  // Spending context
  totalSpent?: {
    daily?: number;
    weekly?: number;
    monthly?: number;
    yearly?: number;
  };
  
  // Transaction history
  transactionsLastHour?: number;
  transactionsLastDay?: number;
  
  // Custom fields
  [key: string]: unknown;
}

// =============================================================================
// POLICY TEMPLATES LIBRARY
// =============================================================================

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: 'spending-limit-daily',
    name: 'Daily Spending Limit',
    description: 'Limits the total amount an agent can spend per day',
    category: 'spending',
    rules: { '<=': [{ var: 'totalSpent.daily' }, { var: 'params.limit' }] },
    parameters: [
      { name: 'limit', type: 'number', description: 'Maximum daily spending amount', required: true },
    ],
    examples: [
      { name: '$500 daily limit', parameters: { limit: 500 }, description: 'Limit daily spending to $500' },
      { name: '$1000 daily limit', parameters: { limit: 1000 }, description: 'Limit daily spending to $1000' },
    ],
  },
  {
    id: 'spending-limit-weekly',
    name: 'Weekly Spending Limit',
    description: 'Limits the total amount an agent can spend per week',
    category: 'spending',
    rules: { '<=': [{ var: 'totalSpent.weekly' }, { var: 'params.limit' }] },
    parameters: [
      { name: 'limit', type: 'number', description: 'Maximum weekly spending amount', required: true },
    ],
    examples: [
      { name: '$2000 weekly limit', parameters: { limit: 2000 }, description: 'Limit weekly spending to $2000' },
    ],
  },
  {
    id: 'spending-limit-monthly',
    name: 'Monthly Spending Limit',
    description: 'Limits the total amount an agent can spend per month',
    category: 'spending',
    rules: { '<=': [{ var: 'totalSpent.monthly' }, { var: 'params.limit' }] },
    parameters: [
      { name: 'limit', type: 'number', description: 'Maximum monthly spending amount', required: true },
    ],
    examples: [
      { name: '$10000 monthly limit', parameters: { limit: 10000 }, description: 'Limit monthly spending to $10000' },
    ],
  },
  {
    id: 'single-transaction-limit',
    name: 'Single Transaction Limit',
    description: 'Limits the maximum amount for a single transaction',
    category: 'spending',
    rules: { '<=': [{ var: 'amount' }, { var: 'params.limit' }] },
    parameters: [
      { name: 'limit', type: 'number', description: 'Maximum transaction amount', required: true },
    ],
    examples: [
      { name: '$500 per transaction', parameters: { limit: 500 }, description: 'Limit each transaction to $500' },
    ],
  },
  {
    id: 'business-hours-only',
    name: 'Business Hours Only',
    description: 'Only allow transactions during business hours',
    category: 'temporal',
    rules: {
      and: [
        { '>=': [{ var: 'hour' }, { var: 'params.startHour' }] },
        { '<=': [{ var: 'hour' }, { var: 'params.endHour' }] },
        { in: [{ var: 'dayOfWeek' }, { var: 'params.allowedDays' }] },
      ],
    },
    parameters: [
      { name: 'startHour', type: 'number', description: 'Start hour (0-23)', default: 9, required: false },
      { name: 'endHour', type: 'number', description: 'End hour (0-23)', default: 17, required: false },
      { name: 'allowedDays', type: 'array', description: 'Allowed days (0=Sun, 6=Sat)', default: [1, 2, 3, 4, 5], required: false },
    ],
    examples: [
      { name: '9-5 weekdays', parameters: { startHour: 9, endHour: 17, allowedDays: [1, 2, 3, 4, 5] }, description: 'Standard business hours' },
      { name: '24/7 weekdays', parameters: { startHour: 0, endHour: 23, allowedDays: [1, 2, 3, 4, 5] }, description: 'Any time on weekdays' },
    ],
  },
  {
    id: 'allowed-categories',
    name: 'Allowed Merchant Categories',
    description: 'Only allow transactions with specific merchant categories',
    category: 'vendor',
    rules: { in: [{ var: 'merchantCategory' }, { var: 'params.categories' }] },
    parameters: [
      { name: 'categories', type: 'array', description: 'List of allowed merchant categories', required: true },
    ],
    examples: [
      { name: 'Software & Office', parameters: { categories: ['software', 'office_supplies'] }, description: 'Only software and office supplies' },
      { name: 'Travel', parameters: { categories: ['airlines', 'hotels', 'car_rental'] }, description: 'Travel-related purchases only' },
    ],
  },
  {
    id: 'blocked-categories',
    name: 'Blocked Merchant Categories',
    description: 'Block transactions with specific merchant categories',
    category: 'vendor',
    rules: { '!': { in: [{ var: 'merchantCategory' }, { var: 'params.categories' }] } },
    parameters: [
      { name: 'categories', type: 'array', description: 'List of blocked merchant categories', required: true },
    ],
    examples: [
      { name: 'Block high-risk', parameters: { categories: ['gambling', 'cryptocurrency', 'adult'] }, description: 'Block high-risk categories' },
    ],
  },
  {
    id: 'rate-limit',
    name: 'Transaction Rate Limit',
    description: 'Limit the number of transactions in a time period',
    category: 'rate_limit',
    rules: { '<=': [{ var: 'transactionsLastHour' }, { var: 'params.maxPerHour' }] },
    parameters: [
      { name: 'maxPerHour', type: 'number', description: 'Maximum transactions per hour', required: true },
    ],
    examples: [
      { name: '10 per hour', parameters: { maxPerHour: 10 }, description: 'Maximum 10 transactions per hour' },
    ],
  },
  {
    id: 'geographic-restriction',
    name: 'Geographic Restriction',
    description: 'Only allow transactions from specific countries',
    category: 'geographic',
    rules: { in: [{ var: 'merchantCountry' }, { var: 'params.countries' }] },
    parameters: [
      { name: 'countries', type: 'array', description: 'List of allowed country codes', required: true },
    ],
    examples: [
      { name: 'US only', parameters: { countries: ['US'] }, description: 'Only US merchants' },
      { name: 'North America', parameters: { countries: ['US', 'CA', 'MX'] }, description: 'US, Canada, Mexico' },
    ],
  },
  {
    id: 'reputation-threshold',
    name: 'Agent Reputation Threshold',
    description: 'Only allow transactions if agent reputation is above threshold',
    category: 'trust',
    rules: { '>=': [{ var: 'agentReputationScore' }, { var: 'params.minScore' }] },
    parameters: [
      { name: 'minScore', type: 'number', description: 'Minimum reputation score (0-100)', required: true },
    ],
    examples: [
      { name: 'High trust only', parameters: { minScore: 80 }, description: 'Only agents with 80+ reputation' },
    ],
  },
];

// =============================================================================
// POLICY ENGINE V2
// =============================================================================

type PrismaClientType = typeof prisma;

export class PolicyEngineV2 {
  private prisma: PrismaClientType;
  private policyVersionCache: Map<string, PolicyVersion[]> = new Map();

  constructor(prisma: PrismaClientType) {
    this.prisma = prisma;
  }

  // =============================================================================
  // POLICY INHERITANCE
  // =============================================================================

  /**
   * Get all applicable policies for an agent, including inherited policies
   */
  async getApplicablePolicies(
    organizationId: string,
    agentId?: string,
    teamId?: string
  ): Promise<Policy[]> {
    const policies: Policy[] = [];

    // 1. Get organization-level policies (highest priority for DENY)
    const orgPolicies = await this.prisma.policy.findMany({
      where: {
        organizationId,
        scope: 'ORGANIZATION',
        isActive: true,
      },
      orderBy: { priority: 'desc' },
    });
    policies.push(...orgPolicies);

    // 2. Get team-level policies (if team specified)
    if (teamId) {
      const teamPolicies = await this.prisma.policy.findMany({
        where: {
          organizationId,
          scope: 'AGENT', // Note: TEAM scope would need schema update
          isActive: true,
          // Would need a teamId field in Policy model
        },
        orderBy: { priority: 'desc' },
      });
      policies.push(...teamPolicies);
    }

    // 3. Get agent-specific policies
    if (agentId) {
      const agentPolicies = await this.prisma.policy.findMany({
        where: {
          organizationId,
          isActive: true,
          assignments: {
            some: { agentId },
          },
        },
        orderBy: { priority: 'desc' },
      });
      policies.push(...agentPolicies);
    }

    // Sort by priority (highest first)
    return policies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Evaluate policies with inheritance
   */
  async evaluateWithInheritance(
    organizationId: string,
    agentId: string,
    context: EvaluationContext,
    teamId?: string
  ): Promise<{
    allowed: boolean;
    action: 'ALLOW' | 'DENY' | 'FLAG';
    matchedPolicy?: Policy;
    evaluationResults: Array<{
      policy: Policy;
      result: boolean;
      level: 'organization' | 'team' | 'agent';
    }>;
  }> {
    const policies = await this.getApplicablePolicies(organizationId, agentId, teamId);
    const results: Array<{
      policy: Policy;
      result: boolean;
      level: 'organization' | 'team' | 'agent';
    }> = [];

    // Evaluate each policy
    for (const policy of policies) {
      const rules = policy.rules as Record<string, unknown>;
      const result = jsonLogic.apply(rules, context);
      
      const level: 'organization' | 'team' | 'agent' = 
        policy.scope === 'ORGANIZATION' ? 'organization' : 'agent';
      
      results.push({ policy, result: Boolean(result), level });

      // DENY policies take precedence
      if (policy.action === 'DENY' && !result) {
        return {
          allowed: false,
          action: 'DENY',
          matchedPolicy: policy,
          evaluationResults: results,
        };
      }
    }

    // Check for FLAG policies
    const flaggedPolicy = results.find(r => r.policy.action === 'FLAG' && !r.result);
    if (flaggedPolicy) {
      return {
        allowed: true,
        action: 'FLAG',
        matchedPolicy: flaggedPolicy.policy,
        evaluationResults: results,
      };
    }

    return {
      allowed: true,
      action: 'ALLOW',
      evaluationResults: results,
    };
  }

  // =============================================================================
  // POLICY VERSIONING
  // =============================================================================

  /**
   * Create a new version of a policy
   */
  async createPolicyVersion(
    policyId: string,
    newRules: Record<string, unknown>,
    changeDescription: string,
    createdBy: string
  ): Promise<Policy> {
    const existingPolicy = await this.prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!existingPolicy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    // Store the old version in cache (in production, this would be a separate table)
    const versions = this.policyVersionCache.get(policyId) || [];
    versions.push({
      version: existingPolicy.version,
      rules: existingPolicy.rules as Record<string, unknown>,
      createdAt: existingPolicy.updatedAt,
      createdBy: existingPolicy.createdById ?? 'unknown',
      changeDescription: 'Previous version',
    });
    this.policyVersionCache.set(policyId, versions);

    // Update the policy with new version
    const updatedPolicy = await this.prisma.policy.update({
      where: { id: policyId },
      data: {
        rules: newRules as Prisma.InputJsonValue,
        version: existingPolicy.version + 1,
        updatedAt: new Date(),
      },
    });

    return updatedPolicy;
  }

  /**
   * Get policy version history
   */
  async getPolicyVersions(policyId: string): Promise<PolicyVersion[]> {
    const currentPolicy = await this.prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!currentPolicy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    const historicalVersions = this.policyVersionCache.get(policyId) || [];
    
    // Add current version
    const allVersions = [
      ...historicalVersions,
      {
        version: currentPolicy.version,
        rules: currentPolicy.rules as Record<string, unknown>,
        createdAt: currentPolicy.updatedAt,
        createdBy: currentPolicy.createdById ?? 'unknown',
        changeDescription: 'Current version',
      },
    ];

    return allVersions.sort((a, b) => b.version - a.version);
  }

  /**
   * Compare two policy versions
   */
  diffPolicyVersions(
    oldRules: Record<string, unknown>,
    newRules: Record<string, unknown>
  ): PolicyDiff[] {
    const diffs: PolicyDiff[] = [];

    const allKeys = new Set([...Object.keys(oldRules), ...Object.keys(newRules)]);

    for (const key of allKeys) {
      const oldValue = oldRules[key];
      const newValue = newRules[key];

      if (oldValue === undefined && newValue !== undefined) {
        diffs.push({ field: key, oldValue, newValue, type: 'added' });
      } else if (oldValue !== undefined && newValue === undefined) {
        diffs.push({ field: key, oldValue, newValue, type: 'removed' });
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        diffs.push({ field: key, oldValue, newValue, type: 'changed' });
      }
    }

    return diffs;
  }

  /**
   * Rollback to a previous version
   */
  async rollbackPolicy(
    policyId: string,
    targetVersion: number,
    rolledBackBy: string
  ): Promise<Policy> {
    const versions = await this.getPolicyVersions(policyId);
    const targetVersionData = versions.find(v => v.version === targetVersion);

    if (!targetVersionData) {
      throw new Error(`Version ${targetVersion} not found for policy ${policyId}`);
    }

    return this.createPolicyVersion(
      policyId,
      targetVersionData.rules,
      `Rollback to version ${targetVersion}`,
      rolledBackBy
    );
  }

  // =============================================================================
  // POLICY SIMULATION
  // =============================================================================

  /**
   * Simulate policy evaluation without affecting real data
   */
  async simulatePolicy(request: PolicySimulationRequest): Promise<PolicySimulationResult> {
    const warnings: string[] = [];
    const evaluationTrace: PolicySimulationResult['evaluationTrace'] = [];
    const matchedPolicies: PolicySimulationResult['matchedPolicies'] = [];

    // Enrich context with time data if not provided
    const enrichedContext = this.enrichContext(request.context);

    // If specific policy ID provided, evaluate just that policy
    if (request.policyId) {
      const policy = await this.prisma.policy.findUnique({
        where: { id: request.policyId },
      });

      if (!policy) {
        throw new Error(`Policy ${request.policyId} not found`);
      }

      const rules = policy.rules as Record<string, unknown>;
      const result = jsonLogic.apply(rules, enrichedContext);

      evaluationTrace.push({
        policyId: policy.id,
        rule: rules,
        context: enrichedContext,
        result: Boolean(result),
      });

      matchedPolicies.push({
        policyId: policy.id,
        name: policy.name,
        result: Boolean(result),
        action: policy.action,
      });

      return {
        wouldAllow: policy.action === 'DENY' ? Boolean(result) : true,
        matchedPolicies,
        evaluationTrace,
        warnings,
      };
    }

    // If rules provided directly, evaluate them
    if (request.rules) {
      const result = jsonLogic.apply(request.rules, enrichedContext);

      evaluationTrace.push({
        policyId: 'simulation',
        rule: request.rules,
        context: enrichedContext,
        result: Boolean(result),
      });

      return {
        wouldAllow: Boolean(result),
        matchedPolicies: [{
          policyId: 'simulation',
          name: 'Simulated Policy',
          result: Boolean(result),
          action: 'DENY',
        }],
        evaluationTrace,
        warnings,
      };
    }

    // Evaluate all applicable policies for the agent
    if (request.agentId) {
      const policies = await this.getApplicablePolicies(
        request.organizationId,
        request.agentId
      );

      let wouldAllow = true;

      for (const policy of policies) {
        const rules = policy.rules as Record<string, unknown>;
        const result = jsonLogic.apply(rules, enrichedContext);

        evaluationTrace.push({
          policyId: policy.id,
          rule: rules,
          context: enrichedContext,
          result: Boolean(result),
        });

        matchedPolicies.push({
          policyId: policy.id,
          name: policy.name,
          result: Boolean(result),
          action: policy.action,
        });

        if (policy.action === 'DENY' && !result) {
          wouldAllow = false;
        }
      }

      return {
        wouldAllow,
        matchedPolicies,
        evaluationTrace,
        warnings,
      };
    }

    throw new Error('Must provide either policyId, rules, or agentId for simulation');
  }

  /**
   * Batch simulate multiple scenarios
   */
  async batchSimulate(
    policyId: string,
    scenarios: Array<{ name: string; context: Record<string, unknown> }>
  ): Promise<Array<{ name: string; result: PolicySimulationResult }>> {
    const policy = await this.prisma.policy.findUnique({
      where: { id: policyId },
    });

    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    const results: Array<{ name: string; result: PolicySimulationResult }> = [];

    for (const scenario of scenarios) {
      const result = await this.simulatePolicy({
        policyId,
        context: scenario.context,
        organizationId: policy.organizationId,
      });
      results.push({ name: scenario.name, result });
    }

    return results;
  }

  // =============================================================================
  // POLICY TEMPLATES
  // =============================================================================

  /**
   * Get all available policy templates
   */
  getTemplates(): PolicyTemplate[] {
    return POLICY_TEMPLATES;
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: string): PolicyTemplate[] {
    return POLICY_TEMPLATES.filter(t => t.category === category);
  }

  /**
   * Get a specific template
   */
  getTemplate(templateId: string): PolicyTemplate | undefined {
    return POLICY_TEMPLATES.find(t => t.id === templateId);
  }

  /**
   * Instantiate a policy from a template
   */
  instantiateTemplate(
    templateId: string,
    parameters: Record<string, unknown>
  ): Record<string, unknown> {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    // Validate required parameters
    for (const param of template.parameters) {
      if (param.required && parameters[param.name] === undefined) {
        throw new Error(`Required parameter ${param.name} is missing`);
      }
    }

    // Create context with parameters
    const context = { params: { ...parameters } };

    // Apply defaults
    for (const param of template.parameters) {
      if (context.params[param.name] === undefined && param.default !== undefined) {
        context.params[param.name] = param.default;
      }
    }

    // The rules reference params via { var: 'params.xxx' }
    // We need to substitute the actual values
    return this.substituteParameters(template.rules, context.params);
  }

  /**
   * Create a policy from a template
   */
  async createPolicyFromTemplate(
    templateId: string,
    parameters: Record<string, unknown>,
    policyData: {
      organizationId: string;
      name: string;
      description?: string;
      priority?: number;
      action?: 'ALLOW' | 'DENY' | 'FLAG';
      createdById: string;
    }
  ): Promise<Policy> {
    const rules = this.instantiateTemplate(templateId, parameters);
    const template = this.getTemplate(templateId)!;

    const policy = await this.prisma.policy.create({
      data: {
        organizationId: policyData.organizationId,
        name: policyData.name,
        description: policyData.description ?? template.description,
        type: this.mapCategoryToType(template.category) as any,
        scope: 'ORGANIZATION',
        rules: rules as Prisma.InputJsonValue,
        action: policyData.action ?? 'DENY',
        priority: policyData.priority ?? 50,
        isActive: true,
        isSystem: false,
        version: 1,
        createdById: policyData.createdById,
        metadata: JSON.parse(JSON.stringify({
          templateId,
          templateParameters: parameters,
        })),
      },
    });

    return policy;
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private enrichContext(context: Record<string, unknown>): EvaluationContext {
    const now = new Date();
    return {
      ...context,
      timestamp: (context.timestamp as number) ?? now.getTime(),
      hour: (context.hour as number) ?? now.getHours(),
      dayOfWeek: (context.dayOfWeek as number) ?? now.getDay(),
      dayOfMonth: (context.dayOfMonth as number) ?? now.getDate(),
      month: (context.month as number) ?? now.getMonth() + 1,
      year: (context.year as number) ?? now.getFullYear(),
    };
  }

  private substituteParameters(
    rules: Record<string, unknown>,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const substitute = (obj: unknown): unknown => {
      if (obj === null || obj === undefined) return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(substitute);
      }
      
      if (typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          if (key === 'var' && typeof value === 'string' && value.startsWith('params.')) {
            const paramName = value.substring(7);
            // Return the actual value instead of the var reference
            return params[paramName];
          }
          result[key] = substitute(value);
        }
        return result;
      }
      
      return obj;
    };

    return substitute(rules) as Record<string, unknown>;
  }

  private mapCategoryToType(category: string): string {
    const mapping: Record<string, string> = {
      spending: 'SPENDING',
      temporal: 'TEMPORAL',
      vendor: 'VENDOR',
      rate_limit: 'RATE_LIMIT',
      geographic: 'GEOGRAPHIC',
      trust: 'TRUST',
    };
    return mapping[category] ?? 'CUSTOM';
  }
}

/**
 * Create a Policy Engine v2 instance
 */
export function createPolicyEngineV2(prisma: PrismaClientType): PolicyEngineV2 {
  return new PolicyEngineV2(prisma);
}
