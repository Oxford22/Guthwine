/**
 * Guthwine - Organization Types
 * Multi-tenant organization hierarchy with parent/subsidiary relationships
 */

import { z } from 'zod';

// Organization tier determines feature access and limits
export const OrganizationTierSchema = z.enum([
  'FREE',
  'STARTER',
  'PROFESSIONAL',
  'ENTERPRISE',
  'WHITE_LABEL',
]);
export type OrganizationTier = z.infer<typeof OrganizationTierSchema>;

// Organization status
export const OrganizationStatusSchema = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'PENDING_VERIFICATION',
  'DEACTIVATED',
]);
export type OrganizationStatus = z.infer<typeof OrganizationStatusSchema>;

// Organization settings schema
export const OrganizationSettingsSchema = z.object({
  // Security settings
  requireMFA: z.boolean().default(false),
  allowedIPRanges: z.array(z.string()).default([]),
  sessionTimeoutMinutes: z.number().min(5).max(1440).default(60),
  
  // Feature flags
  features: z.object({
    semanticFirewall: z.boolean().default(true),
    delegationChains: z.boolean().default(true),
    maxDelegationDepth: z.number().min(1).max(10).default(5),
    customPolicies: z.boolean().default(true),
    apiAccess: z.boolean().default(true),
    webhooks: z.boolean().default(true),
    ssoEnabled: z.boolean().default(false),
    auditLogRetentionDays: z.number().min(30).max(3650).default(365),
  }),
  
  // Rate limits
  rateLimits: z.object({
    mandatesPerMinute: z.number().min(1).max(10000).default(100),
    apiCallsPerMinute: z.number().min(1).max(10000).default(1000),
    semanticEvalsPerMinute: z.number().min(1).max(1000).default(100),
  }),
  
  // Billing settings
  billing: z.object({
    stripeCustomerId: z.string().optional(),
    stripeSubscriptionId: z.string().optional(),
    billingEmail: z.string().email().optional(),
    paymentMethodId: z.string().optional(),
  }),
  
  // White-label settings (for WHITE_LABEL tier)
  whiteLabel: z.object({
    enabled: z.boolean().default(false),
    brandName: z.string().optional(),
    logoUrl: z.string().url().optional(),
    primaryColor: z.string().optional(),
    domain: z.string().optional(),
  }).optional(),
  
  // LLM provider preferences
  llmPreferences: z.object({
    preferredProvider: z.enum(['openai', 'anthropic', 'ollama']).default('openai'),
    fallbackEnabled: z.boolean().default(true),
    maxCostPerEvalCents: z.number().min(1).max(100).default(10),
  }),
});
export type OrganizationSettings = z.infer<typeof OrganizationSettingsSchema>;

// Organization schema
export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  
  // Hierarchy
  parentOrganizationId: z.string().uuid().nullable(),
  
  // Status and tier
  status: OrganizationStatusSchema,
  tier: OrganizationTierSchema,
  
  // Settings (stored as JSON)
  settings: OrganizationSettingsSchema,
  
  // Encryption
  encryptionKeySalt: z.string(), // Used to derive org-specific encryption key
  
  // Metadata
  metadata: z.record(z.unknown()).default({}),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  verifiedAt: z.date().nullable(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

// Create organization input
export const CreateOrganizationInputSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  parentOrganizationId: z.string().uuid().optional(),
  tier: OrganizationTierSchema.default('FREE'),
  settings: OrganizationSettingsSchema.partial().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInputSchema>;

// Update organization input
export const UpdateOrganizationInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: OrganizationStatusSchema.optional(),
  tier: OrganizationTierSchema.optional(),
  settings: OrganizationSettingsSchema.partial().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationInputSchema>;

// Organization usage metrics
export const OrganizationUsageSchema = z.object({
  organizationId: z.string().uuid(),
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),
  metrics: z.object({
    mandatesIssued: z.number(),
    mandatesApproved: z.number(),
    mandatesDenied: z.number(),
    apiCalls: z.number(),
    semanticEvaluations: z.number(),
    llmTokensUsed: z.number(),
    llmCostCents: z.number(),
    activeAgents: z.number(),
    activeDelegations: z.number(),
  }),
});
export type OrganizationUsage = z.infer<typeof OrganizationUsageSchema>;
