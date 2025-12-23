/**
 * Guthwine - Agent Types
 * AI Agent identity and management
 */

import { z } from 'zod';

// Agent status
export const AgentStatusSchema = z.enum([
  'ACTIVE',
  'FROZEN',
  'REVOKED',
  'PENDING_APPROVAL',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// Agent type
export const AgentTypeSchema = z.enum([
  'PRIMARY',      // Root agent owned by user
  'DELEGATED',    // Agent with delegated permissions
  'SERVICE',      // Service account for integrations
  'EPHEMERAL',    // Short-lived agent for specific tasks
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

// Agent capabilities
export const AgentCapabilitiesSchema = z.object({
  canDelegate: z.boolean(),
  canCreateSubAgents: z.boolean(),
  canAccessPaymentRails: z.boolean(),
  canUseSemanticPolicies: z.boolean(),
  maxDelegationDepth: z.number().min(0).max(10),
  allowedPaymentRails: z.array(z.string()),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

// Agent metadata
export const AgentMetadataSchema = z.object({
  description: z.string().nullable(),
  purpose: z.string().nullable(),
  owner: z.string().nullable(),
  tags: z.array(z.string()),
  externalId: z.string().nullable(),
  integrationSource: z.string().nullable(),
  custom: z.record(z.unknown()),
});
export type AgentMetadata = z.infer<typeof AgentMetadataSchema>;

// Agent spending limits
export const AgentSpendingLimitsSchema = z.object({
  maxTransactionAmount: z.number().positive().nullable(),
  maxDailySpend: z.number().positive().nullable(),
  maxWeeklySpend: z.number().positive().nullable(),
  maxMonthlySpend: z.number().positive().nullable(),
  allowedCurrencies: z.array(z.string()),
});
export type AgentSpendingLimits = z.infer<typeof AgentSpendingLimitsSchema>;

// Agent schema
export const AgentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Identity
  did: z.string().regex(/^did:guthwine:[a-zA-Z0-9]+$/),
  name: z.string().min(1).max(255),
  
  // Cryptographic keys
  publicKey: z.string(),
  encryptedPrivateKey: z.string(),
  
  // Hierarchy
  parentAgentId: z.string().uuid().nullable(),
  createdByUserId: z.string().uuid(),
  
  // Type and status
  type: AgentTypeSchema,
  status: AgentStatusSchema,
  
  // Capabilities and limits
  capabilities: AgentCapabilitiesSchema,
  spendingLimits: AgentSpendingLimitsSchema,
  
  // Metadata
  metadata: AgentMetadataSchema,
  
  // Reputation score (0-100)
  reputationScore: z.number().min(0).max(100),
  
  // Freeze info
  frozenAt: z.date().nullable(),
  frozenBy: z.string().uuid().nullable(),
  frozenReason: z.string().nullable(),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  lastActiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
});
export type Agent = z.infer<typeof AgentSchema>;

// Create agent input
export const CreateAgentInputSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: AgentTypeSchema.default('PRIMARY'),
  parentAgentId: z.string().uuid().optional(),
  capabilities: AgentCapabilitiesSchema.partial().optional(),
  spendingLimits: AgentSpendingLimitsSchema.partial().optional(),
  metadata: AgentMetadataSchema.partial().optional(),
  expiresAt: z.date().optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

// Update agent input
export const UpdateAgentInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: AgentStatusSchema.optional(),
  capabilities: AgentCapabilitiesSchema.partial().optional(),
  spendingLimits: AgentSpendingLimitsSchema.partial().optional(),
  metadata: AgentMetadataSchema.partial().optional(),
  expiresAt: z.date().nullable().optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

// Agent freeze input
export const FreezeAgentInputSchema = z.object({
  reason: z.string().min(1).max(1000),
  cascadeToChildren: z.boolean().default(true),
});
export type FreezeAgentInput = z.infer<typeof FreezeAgentInputSchema>;

// Agent statistics
export const AgentStatisticsSchema = z.object({
  agentId: z.string().uuid(),
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),
  stats: z.object({
    totalTransactions: z.number(),
    approvedTransactions: z.number(),
    deniedTransactions: z.number(),
    totalSpend: z.number(),
    averageTransactionAmount: z.number(),
    uniqueMerchants: z.number(),
    policyViolations: z.number(),
    delegationsIssued: z.number(),
    delegationsReceived: z.number(),
    childAgents: z.number(),
  }),
});
export type AgentStatistics = z.infer<typeof AgentStatisticsSchema>;

// Agent tree node (for visualization)
export const AgentTreeNodeSchema = z.lazy((): z.ZodType<AgentTreeNode> =>
  z.object({
    agent: AgentSchema,
    children: z.array(AgentTreeNodeSchema),
    delegations: z.array(z.object({
      tokenId: z.string(),
      recipientDid: z.string(),
      constraints: z.record(z.unknown()),
      expiresAt: z.date(),
    })),
    depth: z.number(),
    blastRadius: z.number(), // Number of agents affected if this one is frozen
  })
);
export type AgentTreeNode = {
  agent: Agent;
  children: AgentTreeNode[];
  delegations: {
    tokenId: string;
    recipientDid: string;
    constraints: Record<string, unknown>;
    expiresAt: Date;
  }[];
  depth: number;
  blastRadius: number;
};
