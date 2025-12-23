/**
 * Guthwine - Policy Types
 * Policy definitions with JSON Logic and semantic constraints
 */

import { z } from 'zod';

// Policy type
export const PolicyTypeSchema = z.enum([
  'SPENDING',     // Amount-based rules
  'TEMPORAL',     // Time-based rules
  'VENDOR',       // Merchant/vendor restrictions
  'SEMANTIC',     // LLM-evaluated natural language constraints
  'COMPOSITE',    // Combination of multiple rule types
  'RATE_LIMIT',   // Transaction frequency limits
  'GEOGRAPHIC',   // Location-based restrictions
]);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;

// Policy action on match
export const PolicyActionSchema = z.enum([
  'ALLOW',        // Explicitly allow
  'DENY',         // Explicitly deny
  'FLAG',         // Allow but flag for review
  'REQUIRE_MFA',  // Require additional authentication
  'NOTIFY',       // Allow and notify
]);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

// Policy scope
export const PolicyScopeSchema = z.enum([
  'ORGANIZATION', // Applies to all agents in org
  'AGENT',        // Applies to specific agent
  'DELEGATION',   // Applies via delegation chain
]);
export type PolicyScope = z.infer<typeof PolicyScopeSchema>;

// JSON Logic rule (flexible schema)
export const JsonLogicRuleSchema = z.record(z.unknown());
export type JsonLogicRule = z.infer<typeof JsonLogicRuleSchema>;

// Semantic constraint configuration
export const SemanticConstraintConfigSchema = z.object({
  constraint: z.string().min(1).max(2000),
  strictness: z.enum(['BLOCK', 'FLAG', 'LOG']).default('FLAG'),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  llmConfig: z.object({
    provider: z.enum(['openai', 'anthropic', 'ollama']).default('openai'),
    model: z.string().default('gpt-4o-mini'),
    maxTokens: z.number().min(50).max(500).default(150),
    temperature: z.number().min(0).max(1).default(0),
  }),
  cacheEnabled: z.boolean().default(true),
  cacheTTLSeconds: z.number().min(60).max(86400).default(3600),
});
export type SemanticConstraintConfig = z.infer<typeof SemanticConstraintConfigSchema>;

// Policy schema
export const PolicySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Identity
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable(),
  
  // Type and scope
  type: PolicyTypeSchema,
  scope: PolicyScopeSchema,
  
  // Rules
  rules: JsonLogicRuleSchema,
  semanticConstraint: SemanticConstraintConfigSchema.nullable(),
  
  // Action and priority
  action: PolicyActionSchema,
  priority: z.number().int().min(0).max(1000).default(100),
  
  // Status
  isActive: z.boolean().default(true),
  isSystem: z.boolean().default(false), // System policies cannot be deleted
  
  // Versioning
  version: z.number().int().min(1).default(1),
  previousVersionId: z.string().uuid().nullable(),
  
  // Metadata
  metadata: z.record(z.unknown()).default({}),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  createdById: z.string().uuid(),
});
export type Policy = z.infer<typeof PolicySchema>;

// Policy assignment (junction table)
export const PolicyAssignmentSchema = z.object({
  id: z.string().uuid(),
  policyId: z.string().uuid(),
  agentId: z.string().uuid(),
  
  // Override settings
  overridePriority: z.number().int().nullable(),
  overrideAction: PolicyActionSchema.nullable(),
  
  // Timestamps
  assignedAt: z.date(),
  assignedById: z.string().uuid(),
});
export type PolicyAssignment = z.infer<typeof PolicyAssignmentSchema>;

// Create policy input
export const CreatePolicyInputSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  type: PolicyTypeSchema,
  scope: PolicyScopeSchema.default('ORGANIZATION'),
  rules: JsonLogicRuleSchema,
  semanticConstraint: SemanticConstraintConfigSchema.optional(),
  action: PolicyActionSchema.default('DENY'),
  priority: z.number().int().min(0).max(1000).default(100),
  metadata: z.record(z.unknown()).optional(),
});
export type CreatePolicyInput = z.infer<typeof CreatePolicyInputSchema>;

// Update policy input
export const UpdatePolicyInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  rules: JsonLogicRuleSchema.optional(),
  semanticConstraint: SemanticConstraintConfigSchema.nullable().optional(),
  action: PolicyActionSchema.optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdatePolicyInput = z.infer<typeof UpdatePolicyInputSchema>;

// Policy evaluation context
export const PolicyEvaluationContextSchema = z.object({
  // Transaction details
  amount: z.number(),
  currency: z.string(),
  merchantId: z.string(),
  merchantName: z.string().nullable(),
  merchantCategory: z.string().nullable(),
  merchantMetadata: z.record(z.unknown()).default({}),
  
  // Agent context
  agentId: z.string(),
  agentDid: z.string(),
  agentType: z.string(),
  agentSpendToday: z.number(),
  agentSpendThisWeek: z.number(),
  agentSpendThisMonth: z.number(),
  agentTransactionsToday: z.number(),
  
  // Delegation context
  delegationDepth: z.number(),
  delegationChainDids: z.array(z.string()),
  
  // Temporal context
  timestamp: z.date(),
  dayOfWeek: z.number().min(0).max(6),
  hourOfDay: z.number().min(0).max(23),
  isWeekend: z.boolean(),
  isBusinessHours: z.boolean(),
  
  // Geographic context (if available)
  ipAddress: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  
  // AI context
  reasoningTrace: z.string().nullable(),
  transactionDescription: z.string().nullable(),
  
  // Custom context
  custom: z.record(z.unknown()).default({}),
});
export type PolicyEvaluationContext = z.infer<typeof PolicyEvaluationContextSchema>;

// Policy evaluation result
export const PolicyEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  action: PolicyActionSchema,
  
  // Matched policies
  matchedPolicies: z.array(z.object({
    policyId: z.string(),
    policyName: z.string(),
    policyType: PolicyTypeSchema,
    action: PolicyActionSchema,
    matched: z.boolean(),
    reason: z.string().nullable(),
  })),
  
  // Blocking policy (if denied)
  blockingPolicy: z.object({
    policyId: z.string(),
    policyName: z.string(),
    reason: z.string(),
  }).nullable(),
  
  // Semantic evaluation (if applicable)
  semanticEvaluation: z.object({
    evaluated: z.boolean(),
    compliant: z.boolean().nullable(),
    confidence: z.number().nullable(),
    reasoning: z.string().nullable(),
    llmProvider: z.string().nullable(),
    llmModel: z.string().nullable(),
    tokenCount: z.number().nullable(),
    costCents: z.number().nullable(),
    latencyMs: z.number().nullable(),
    cached: z.boolean(),
  }).nullable(),
  
  // Risk assessment
  riskScore: z.number().min(0).max(100),
  riskFactors: z.array(z.object({
    factor: z.string(),
    score: z.number(),
    weight: z.number(),
    description: z.string(),
  })),
  
  // Performance
  evaluationTimeMs: z.number(),
  policiesEvaluated: z.number(),
});
export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;

// Policy templates
export const POLICY_TEMPLATES = {
  maxTransactionAmount: (limit: number) => ({
    '<=': [{ var: 'amount' }, limit],
  }),
  
  maxDailySpend: (limit: number) => ({
    '<=': [{ '+': [{ var: 'agentSpendToday' }, { var: 'amount' }] }, limit],
  }),
  
  maxMonthlySpend: (limit: number) => ({
    '<=': [{ '+': [{ var: 'agentSpendThisMonth' }, { var: 'amount' }] }, limit],
  }),
  
  allowedMerchants: (merchantIds: string[]) => ({
    in: [{ var: 'merchantId' }, merchantIds],
  }),
  
  blockedMerchants: (merchantIds: string[]) => ({
    '!': { in: [{ var: 'merchantId' }, merchantIds] },
  }),
  
  allowedCategories: (categories: string[]) => ({
    in: [{ var: 'merchantCategory' }, categories],
  }),
  
  blockedCategories: (categories: string[]) => ({
    '!': { in: [{ var: 'merchantCategory' }, categories] },
  }),
  
  businessHoursOnly: (startHour = 9, endHour = 17, timezone = 'UTC') => ({
    and: [
      { '>=': [{ var: 'hourOfDay' }, startHour] },
      { '<': [{ var: 'hourOfDay' }, endHour] },
      { '!': { var: 'isWeekend' } },
    ],
  }),
  
  weekdaysOnly: () => ({
    '!': { var: 'isWeekend' },
  }),
  
  maxDelegationDepth: (depth: number) => ({
    '<=': [{ var: 'delegationDepth' }, depth],
  }),
  
  maxTransactionsPerDay: (limit: number) => ({
    '<': [{ var: 'agentTransactionsToday' }, limit],
  }),
  
  allowedCurrencies: (currencies: string[]) => ({
    in: [{ var: 'currency' }, currencies],
  }),
  
  requireReasoningTrace: () => ({
    '!!': { var: 'reasoningTrace' },
  }),
  
  combinedRule: (rules: unknown[]) => ({
    and: rules,
  }),
  
  anyOfRules: (rules: unknown[]) => ({
    or: rules,
  }),
} as const;
