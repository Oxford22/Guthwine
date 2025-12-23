/**
 * Guthwine - Delegation Types
 * Hierarchical delegation with constraint inheritance
 */

import { z } from 'zod';

// Delegation status
export const DelegationStatusSchema = z.enum([
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'SUSPENDED',
]);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

// Delegation constraints
export const DelegationConstraintsSchema = z.object({
  // Spending limits
  maxAmount: z.number().positive().nullable(),
  maxDailySpend: z.number().positive().nullable(),
  maxWeeklySpend: z.number().positive().nullable(),
  maxTotalSpend: z.number().positive().nullable(),
  
  // Currency restrictions
  allowedCurrencies: z.array(z.string()).nullable(),
  
  // Merchant restrictions
  allowedMerchants: z.array(z.string()).nullable(),
  blockedMerchants: z.array(z.string()).nullable(),
  allowedCategories: z.array(z.string()).nullable(),
  blockedCategories: z.array(z.string()).nullable(),
  
  // Temporal restrictions
  validFrom: z.date().nullable(),
  validUntil: z.date().nullable(),
  allowedDaysOfWeek: z.array(z.number().min(0).max(6)).nullable(),
  allowedHoursStart: z.number().min(0).max(23).nullable(),
  allowedHoursEnd: z.number().min(0).max(23).nullable(),
  timezone: z.string().nullable(),
  
  // Delegation chain restrictions
  canSubDelegate: z.boolean(),
  maxSubDelegationDepth: z.number().min(0).max(10),
  
  // Semantic constraints
  semanticConstraints: z.string().nullable(),
  
  // Custom constraints
  custom: z.record(z.unknown()),
});
export type DelegationConstraints = z.infer<typeof DelegationConstraintsSchema>;

// Delegation token payload (JWT)
export const DelegationTokenPayloadSchema = z.object({
  // Standard JWT claims
  iss: z.string(), // Issuer DID
  sub: z.string(), // Subject (recipient) DID
  aud: z.string(), // Audience (guthwine)
  iat: z.number(), // Issued at
  exp: z.number(), // Expiration
  jti: z.string(), // Token ID
  
  // Guthwine-specific claims
  guthwine: z.object({
    type: z.literal('DELEGATION'),
    version: z.number(),
    organizationId: z.string(),
    parentTokenId: z.string().nullable(),
    constraints: DelegationConstraintsSchema,
    depth: z.number(),
    chainHash: z.string(), // Hash of the delegation chain for integrity
  }),
});
export type DelegationTokenPayload = z.infer<typeof DelegationTokenPayloadSchema>;

// Delegation token (stored)
export const DelegationTokenSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Parties
  issuerAgentId: z.string().uuid(),
  issuerDid: z.string(),
  recipientAgentId: z.string().uuid(),
  recipientDid: z.string(),
  
  // Token
  tokenJti: z.string(), // JWT ID
  signedToken: z.string(), // Full signed JWT
  tokenHash: z.string(), // Hash for quick lookup
  
  // Chain
  parentTokenId: z.string().uuid().nullable(),
  depth: z.number().int().min(0),
  chainHash: z.string(),
  
  // Constraints
  constraints: DelegationConstraintsSchema,
  
  // Usage tracking
  usageCount: z.number().int(),
  totalSpent: z.number(),
  lastUsedAt: z.date().nullable(),
  
  // Status
  status: DelegationStatusSchema,
  revokedAt: z.date().nullable(),
  revokedBy: z.string().uuid().nullable(),
  revokedReason: z.string().nullable(),
  
  // Timestamps
  createdAt: z.date(),
  expiresAt: z.date(),
});
export type DelegationToken = z.infer<typeof DelegationTokenSchema>;

// Create delegation input
export const CreateDelegationInputSchema = z.object({
  organizationId: z.string().uuid(),
  issuerAgentId: z.string().uuid(),
  recipientAgentId: z.string().uuid(),
  constraints: DelegationConstraintsSchema.partial(),
  expiresInSeconds: z.number().int().min(60).max(31536000).default(86400), // 1 day default
  parentTokenId: z.string().uuid().optional(),
});
export type CreateDelegationInput = z.infer<typeof CreateDelegationInputSchema>;

// Revoke delegation input
export const RevokeDelegationInputSchema = z.object({
  reason: z.string().min(1).max(1000),
  cascadeToChildren: z.boolean().default(true),
});
export type RevokeDelegationInput = z.infer<typeof RevokeDelegationInputSchema>;

// Delegation chain verification result
export const DelegationChainVerificationResultSchema = z.object({
  valid: z.boolean(),
  chainDepth: z.number(),
  
  // Chain details
  chain: z.array(z.object({
    tokenId: z.string(),
    issuerDid: z.string(),
    recipientDid: z.string(),
    depth: z.number(),
    valid: z.boolean(),
    error: z.string().nullable(),
  })),
  
  // Accumulated constraints (most restrictive)
  effectiveConstraints: DelegationConstraintsSchema,
  
  // Root issuer
  rootIssuerDid: z.string().nullable(),
  rootIssuerAgentId: z.string().nullable(),
  
  // Errors
  errors: z.array(z.string()),
  
  // Verification metadata
  verificationTimeMs: z.number(),
});
export type DelegationChainVerificationResult = z.infer<typeof DelegationChainVerificationResultSchema>;

// Delegation tree node (for visualization)
export const DelegationTreeNodeSchema = z.lazy((): z.ZodType<DelegationTreeNode> =>
  z.object({
    token: DelegationTokenSchema,
    issuerAgent: z.object({
      id: z.string(),
      did: z.string(),
      name: z.string(),
    }),
    recipientAgent: z.object({
      id: z.string(),
      did: z.string(),
      name: z.string(),
    }),
    children: z.array(DelegationTreeNodeSchema),
    depth: z.number(),
    isExpired: z.boolean(),
    isRevoked: z.boolean(),
    effectiveConstraints: DelegationConstraintsSchema,
  })
);
export type DelegationTreeNode = {
  token: DelegationToken;
  issuerAgent: {
    id: string;
    did: string;
    name: string;
  };
  recipientAgent: {
    id: string;
    did: string;
    name: string;
  };
  children: DelegationTreeNode[];
  depth: number;
  isExpired: boolean;
  isRevoked: boolean;
  effectiveConstraints: DelegationConstraints;
};

// Delegation anomaly types
export const DelegationAnomalyTypeSchema = z.enum([
  'UNUSUAL_DEPTH',           // Chain deeper than typical
  'RAPID_CREATION',          // Many delegations in short time
  'CIRCULAR_REFERENCE',      // Attempted circular delegation
  'CONSTRAINT_ESCALATION',   // Attempted to exceed parent constraints
  'EXPIRED_PARENT',          // Parent token expired
  'REVOKED_PARENT',          // Parent token revoked
  'UNKNOWN_RECIPIENT',       // Recipient not in organization
  'CROSS_ORG_DELEGATION',    // Attempted cross-org delegation
]);
export type DelegationAnomalyType = z.infer<typeof DelegationAnomalyTypeSchema>;

// Delegation anomaly
export const DelegationAnomalySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tokenId: z.string().uuid().nullable(),
  
  type: DelegationAnomalyTypeSchema,
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  
  details: z.object({
    description: z.string(),
    affectedAgents: z.array(z.string()),
    suggestedAction: z.string(),
    metadata: z.record(z.unknown()),
  }),
  
  // Resolution
  resolvedAt: z.date().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolution: z.string().nullable(),
  
  createdAt: z.date(),
});
export type DelegationAnomaly = z.infer<typeof DelegationAnomalySchema>;
