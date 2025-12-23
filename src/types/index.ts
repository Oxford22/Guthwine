/**
 * Guthwine - Sovereign Governance Layer Types
 * Core type definitions for the authorization and delegation system
 */

import { z } from 'zod';

// ============================================================================
// Transaction Types
// ============================================================================

export const TransactionRequestSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('USD'),
  merchantId: z.string(),
  merchantName: z.string().optional(),
  merchantCategory: z.string().optional(),
  reasoningTrace: z.string().describe('AI agent explanation for the transaction'),
  metadata: z.record(z.any()).optional(),
});

export type TransactionRequest = z.infer<typeof TransactionRequestSchema>;

export const TransactionDecision = z.enum([
  'ALLOW',
  'DENY',
  'PENDING_HUMAN_APPROVAL',
  'FROZEN',
]);

export type TransactionDecisionType = z.infer<typeof TransactionDecision>;

export interface TransactionResponse {
  decision: TransactionDecisionType;
  mandate?: string; // Signed JWT if allowed
  reason: string;
  policyViolations?: string[];
  riskScore?: number;
  auditLogId?: number;
}

// ============================================================================
// Agent Identity Types
// ============================================================================

export const AgentRegistrationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  ownerDid: z.string().optional(),
});

export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;

export interface AgentIdentity {
  id: string;
  did: string;
  name: string;
  description?: string;
  publicKey: string;
  ownerDid?: string;
  isFrozen: boolean;
  createdAt: Date;
}

// ============================================================================
// Delegation Types
// ============================================================================

export const DelegationConstraintsSchema = z.object({
  maxAmount: z.number().positive().optional(),
  currency: z.string().optional(),
  allowedMerchants: z.array(z.string()).optional(),
  allowedCategories: z.array(z.string()).optional(),
  semanticConstraints: z.string().optional(),
  expiresIn: z.number().positive().default(3600), // seconds
});

export type DelegationConstraints = z.infer<typeof DelegationConstraintsSchema>;

export const IssueDelegationSchema = z.object({
  recipientDid: z.string(),
  constraints: DelegationConstraintsSchema,
});

export type IssueDelegation = z.infer<typeof IssueDelegationSchema>;

export interface DelegationTokenPayload {
  iss: string; // Issuer DID
  sub: string; // Recipient DID
  iat: number; // Issued at
  exp: number; // Expiration
  constraints: DelegationConstraints;
  parentTokenHash?: string; // For recursive delegation
}

// ============================================================================
// Policy Types
// ============================================================================

export const PolicyRuleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  rules: z.any(), // JSON Logic rules
  semanticConstraints: z.string().optional(),
  priority: z.number().default(0),
  isActive: z.boolean().default(true),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export interface PolicyEvaluationResult {
  allowed: boolean;
  violations: string[];
  matchedPolicies: string[];
  semanticCheckResult?: {
    passed: boolean;
    reason: string;
    confidence: number;
  };
}

// ============================================================================
// Audit Types
// ============================================================================

export const AuditAction = z.enum([
  'REQUEST_SIGNATURE',
  'DELEGATION_ISSUED',
  'DELEGATION_REVOKED',
  'POLICY_CHECK',
  'AGENT_REGISTERED',
  'AGENT_FROZEN',
  'AGENT_UNFROZEN',
  'RATE_LIMIT_TRIGGERED',
  'SEMANTIC_CHECK',
  'HUMAN_APPROVAL_REQUESTED',
]);

export type AuditActionType = z.infer<typeof AuditAction>;

export interface AuditEntry {
  agentDid: string;
  action: AuditActionType;
  transactionType?: string;
  amount?: number;
  currency?: string;
  merchantId?: string;
  reasoningTrace?: string;
  policySnapshotId?: string;
  decision: TransactionDecisionType;
  decisionReason?: string;
  delegationChain?: string[];
}

// ============================================================================
// Vault Types
// ============================================================================

export const VaultKeySchema = z.object({
  keyName: z.string(),
  value: z.string(),
});

export type VaultKey = z.infer<typeof VaultKeySchema>;

// ============================================================================
// Rate Limit Types
// ============================================================================

export interface RateLimitConfig {
  windowSizeMs: number;
  maxAmount: number;
  maxTransactions: number;
}

export interface RateLimitStatus {
  isLimited: boolean;
  currentSpend: number;
  transactionCount: number;
  windowReset: Date;
  remainingBudget: number;
}

// ============================================================================
// MCP Tool Schemas
// ============================================================================

export const RequestTransactionSignatureSchema = z.object({
  agentDid: z.string().describe('The DID of the requesting agent'),
  amount: z.number().positive().describe('Transaction amount'),
  currency: z.string().default('USD').describe('Currency code'),
  merchantId: z.string().describe('Merchant identifier'),
  merchantName: z.string().optional().describe('Human-readable merchant name'),
  merchantCategory: z.string().optional().describe('Merchant category code'),
  reasoningTrace: z.string().describe('AI explanation for why this transaction is needed'),
  delegationChain: z.array(z.string()).optional().describe('Array of delegation token JWTs'),
});

export type RequestTransactionSignature = z.infer<typeof RequestTransactionSignatureSchema>;

export const RegisterAgentSchema = z.object({
  name: z.string().describe('Agent name'),
  description: z.string().optional().describe('Agent description'),
  ownerDid: z.string().optional().describe('Parent agent or user DID'),
});

export type RegisterAgent = z.infer<typeof RegisterAgentSchema>;

export const IssueDelegationToolSchema = z.object({
  issuerDid: z.string().describe('DID of the agent issuing the delegation'),
  recipientDid: z.string().describe('DID of the agent receiving delegation'),
  maxAmount: z.number().positive().optional().describe('Maximum transaction amount'),
  currency: z.string().optional().describe('Allowed currency'),
  allowedMerchants: z.array(z.string()).optional().describe('List of allowed merchant IDs'),
  allowedCategories: z.array(z.string()).optional().describe('List of allowed merchant categories'),
  semanticConstraints: z.string().optional().describe('Natural language constraints'),
  expiresInSeconds: z.number().positive().default(3600).describe('Token expiration in seconds'),
});

export type IssueDelegationTool = z.infer<typeof IssueDelegationToolSchema>;

export const RevokeDelegationSchema = z.object({
  tokenHash: z.string().describe('Hash of the delegation token to revoke'),
  reason: z.string().describe('Reason for revocation'),
});

export type RevokeDelegation = z.infer<typeof RevokeDelegationSchema>;

export const FreezeAgentSchema = z.object({
  agentDid: z.string().describe('DID of the agent to freeze'),
  reason: z.string().describe('Reason for freezing'),
});

export type FreezeAgent = z.infer<typeof FreezeAgentSchema>;

export const GetAuditTrailSchema = z.object({
  agentDid: z.string().optional().describe('Filter by agent DID'),
  startTime: z.string().optional().describe('Start time (ISO 8601)'),
  endTime: z.string().optional().describe('End time (ISO 8601)'),
  action: z.string().optional().describe('Filter by action type'),
  limit: z.number().positive().default(100).describe('Maximum number of entries'),
});

export type GetAuditTrail = z.infer<typeof GetAuditTrailSchema>;

export const AddPolicySchema = z.object({
  agentDid: z.string().describe('Agent DID to add policy for'),
  name: z.string().describe('Policy name'),
  description: z.string().optional().describe('Policy description'),
  rules: z.any().describe('JSON Logic rules'),
  semanticConstraints: z.string().optional().describe('Natural language constraints'),
  priority: z.number().default(0).describe('Policy priority (higher = evaluated first)'),
});

export type AddPolicy = z.infer<typeof AddPolicySchema>;
