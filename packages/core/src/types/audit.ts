/**
 * Guthwine - Audit Types
 * Immutable audit log with Merkle tree verification
 */

import { z } from 'zod';

// Audit action types
export const AuditActionSchema = z.enum([
  // Organization
  'ORG_CREATED',
  'ORG_UPDATED',
  'ORG_SETTINGS_CHANGED',
  'ORG_TIER_CHANGED',
  'ORG_SUSPENDED',
  'ORG_ACTIVATED',
  
  // Users
  'USER_CREATED',
  'USER_INVITED',
  'USER_UPDATED',
  'USER_ROLE_CHANGED',
  'USER_SUSPENDED',
  'USER_ACTIVATED',
  'USER_DELETED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_LOGIN_FAILED',
  'USER_MFA_ENABLED',
  'USER_MFA_DISABLED',
  'USER_PASSWORD_CHANGED',
  
  // Agents
  'AGENT_CREATED',
  'AGENT_UPDATED',
  'AGENT_FROZEN',
  'AGENT_UNFROZEN',
  'AGENT_REVOKED',
  'AGENT_KEY_ROTATED',
  
  // Policies
  'POLICY_CREATED',
  'POLICY_UPDATED',
  'POLICY_DELETED',
  'POLICY_ASSIGNED',
  'POLICY_UNASSIGNED',
  
  // Delegations
  'DELEGATION_CREATED',
  'DELEGATION_REVOKED',
  'DELEGATION_EXPIRED',
  'DELEGATION_USED',
  
  // Transactions
  'TRANSACTION_REQUESTED',
  'TRANSACTION_APPROVED',
  'TRANSACTION_DENIED',
  'TRANSACTION_EXPIRED',
  'TRANSACTION_EXECUTED',
  'TRANSACTION_FAILED',
  'TRANSACTION_REVIEWED',
  
  // Mandates
  'MANDATE_ISSUED',
  'MANDATE_USED',
  'MANDATE_EXPIRED',
  'MANDATE_REVOKED',
  
  // API
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
  'API_KEY_USED',
  
  // System
  'GLOBAL_FREEZE_ENABLED',
  'GLOBAL_FREEZE_DISABLED',
  'SYSTEM_CONFIG_CHANGED',
  'RATE_LIMIT_EXCEEDED',
  'ANOMALY_DETECTED',
  
  // Compliance
  'COMPLIANCE_REPORT_GENERATED',
  'DATA_EXPORT_REQUESTED',
  'DATA_DELETION_REQUESTED',
  'RIGHT_TO_EXPLANATION_REQUESTED',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

// Audit severity
export const AuditSeveritySchema = z.enum([
  'DEBUG',
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);
export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

// Audit entry schema
export const AuditEntrySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Sequence for Merkle chain
  sequenceNumber: z.number().int().positive(),
  
  // Action
  action: AuditActionSchema,
  severity: AuditSeveritySchema,
  
  // Actor
  actorType: z.enum(['USER', 'AGENT', 'SYSTEM', 'API_KEY']),
  actorId: z.string().nullable(),
  actorDid: z.string().nullable(),
  actorIp: z.string().nullable(),
  actorUserAgent: z.string().nullable(),
  
  // Target
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  
  // Payload
  payload: z.record(z.unknown()),
  
  // Related entities
  transactionId: z.string().uuid().nullable(),
  agentId: z.string().uuid().nullable(),
  policyId: z.string().uuid().nullable(),
  delegationId: z.string().uuid().nullable(),
  
  // Merkle chain
  previousHash: z.string().nullable(),
  entryHash: z.string(),
  signature: z.string(), // Signed by system key
  
  // Timestamps
  timestamp: z.date(),
  
  // Retention
  retainUntil: z.date(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// Create audit entry input
export const CreateAuditEntryInputSchema = z.object({
  organizationId: z.string().uuid(),
  action: AuditActionSchema,
  severity: AuditSeveritySchema.default('INFO'),
  
  actorType: z.enum(['USER', 'AGENT', 'SYSTEM', 'API_KEY']),
  actorId: z.string().nullable().default(null),
  actorDid: z.string().nullable().default(null),
  actorIp: z.string().nullable().default(null),
  actorUserAgent: z.string().nullable().default(null),
  
  targetType: z.string().nullable().default(null),
  targetId: z.string().nullable().default(null),
  
  payload: z.record(z.unknown()).default({}),
  
  transactionId: z.string().uuid().nullable().default(null),
  agentId: z.string().uuid().nullable().default(null),
  policyId: z.string().uuid().nullable().default(null),
  delegationId: z.string().uuid().nullable().default(null),
});
export type CreateAuditEntryInput = z.infer<typeof CreateAuditEntryInputSchema>;

// Audit query options
export const AuditQueryOptionsSchema = z.object({
  organizationId: z.string().uuid(),
  
  // Filters
  actions: z.array(AuditActionSchema).optional(),
  severities: z.array(AuditSeveritySchema).optional(),
  actorTypes: z.array(z.enum(['USER', 'AGENT', 'SYSTEM', 'API_KEY'])).optional(),
  actorId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  transactionId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  
  // Time range
  startTime: z.date().optional(),
  endTime: z.date().optional(),
  
  // Pagination
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
  
  // Sorting
  sortBy: z.enum(['timestamp', 'sequenceNumber']).default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type AuditQueryOptions = z.infer<typeof AuditQueryOptionsSchema>;

// Audit query result
export const AuditQueryResultSchema = z.object({
  entries: z.array(AuditEntrySchema),
  total: z.number(),
  hasMore: z.boolean(),
  
  // Integrity check
  chainValid: z.boolean(),
  chainErrors: z.array(z.string()),
});
export type AuditQueryResult = z.infer<typeof AuditQueryResultSchema>;

// Merkle root schema
export const MerkleRootSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  rootHash: z.string(),
  startSequence: z.number().int(),
  endSequence: z.number().int(),
  entryCount: z.number().int(),
  
  // Verification
  signature: z.string(),
  
  // Timestamps
  createdAt: z.date(),
  
  // External anchoring (optional)
  anchoredTo: z.string().nullable(), // e.g., "ethereum:0x..."
  anchoredAt: z.date().nullable(),
  anchorTxHash: z.string().nullable(),
});
export type MerkleRoot = z.infer<typeof MerkleRootSchema>;

// Chain verification result
export const ChainVerificationResultSchema = z.object({
  valid: z.boolean(),
  
  // Range checked
  startSequence: z.number(),
  endSequence: z.number(),
  entriesChecked: z.number(),
  
  // Errors
  errors: z.array(z.object({
    sequenceNumber: z.number(),
    expectedHash: z.string(),
    actualHash: z.string(),
    error: z.string(),
  })),
  
  // Merkle root
  computedMerkleRoot: z.string(),
  storedMerkleRoot: z.string().nullable(),
  merkleRootValid: z.boolean(),
  
  // Performance
  verificationTimeMs: z.number(),
});
export type ChainVerificationResult = z.infer<typeof ChainVerificationResultSchema>;

// Compliance report schema
export const ComplianceReportSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Report type
  type: z.enum([
    'TRANSACTION_SUMMARY',
    'AGENT_ACTIVITY',
    'POLICY_VIOLATIONS',
    'DELEGATION_AUDIT',
    'FULL_AUDIT_EXPORT',
    'IMPACT_ASSESSMENT',
    'RIGHT_TO_EXPLANATION',
  ]),
  
  // Time range
  startTime: z.date(),
  endTime: z.date(),
  
  // Content
  summary: z.record(z.unknown()),
  details: z.record(z.unknown()),
  
  // Generated file
  fileUrl: z.string().url().nullable(),
  fileFormat: z.enum(['JSON', 'CSV', 'PDF']),
  fileSizeBytes: z.number().nullable(),
  
  // Metadata
  generatedAt: z.date(),
  generatedBy: z.string().uuid(),
  expiresAt: z.date(),
});
export type ComplianceReport = z.infer<typeof ComplianceReportSchema>;

// Right to explanation request
export const ExplanationRequestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  transactionId: z.string().uuid(),
  
  // Requester
  requestedBy: z.string().uuid(),
  requestedAt: z.date(),
  
  // Explanation
  explanation: z.object({
    decision: z.string(),
    reasoning: z.string(),
    policiesApplied: z.array(z.object({
      policyId: z.string(),
      policyName: z.string(),
      result: z.string(),
      explanation: z.string(),
    })),
    delegationChain: z.array(z.object({
      issuerDid: z.string(),
      recipientDid: z.string(),
      constraints: z.record(z.unknown()),
    })),
    riskFactors: z.array(z.object({
      factor: z.string(),
      score: z.number(),
      explanation: z.string(),
    })),
    semanticEvaluation: z.object({
      constraint: z.string(),
      result: z.string(),
      confidence: z.number(),
      reasoning: z.string(),
    }).nullable(),
    humanReadableSummary: z.string(),
  }),
  
  // Delivery
  deliveredAt: z.date().nullable(),
  deliveryMethod: z.enum(['EMAIL', 'API', 'DASHBOARD']).nullable(),
});
export type ExplanationRequest = z.infer<typeof ExplanationRequestSchema>;
