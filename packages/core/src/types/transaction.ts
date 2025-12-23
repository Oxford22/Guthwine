/**
 * Guthwine - Transaction Types
 * Transaction requests, mandates, and payment rail integration
 */

import { z } from 'zod';
import { PolicyEvaluationResultSchema } from './policy.js';

// Transaction status
export const TransactionStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'DENIED',
  'EXPIRED',
  'EXECUTED',
  'FAILED',
  'CANCELLED',
  'REQUIRES_REVIEW',
]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

// Transaction type
export const TransactionTypeSchema = z.enum([
  'PAYMENT',
  'TRANSFER',
  'REFUND',
  'AUTHORIZATION',
  'CAPTURE',
  'VOID',
]);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

// Payment rail
export const PaymentRailSchema = z.enum([
  'STRIPE',
  'COINBASE',
  'WISE',
  'PLAID',
  'WEBHOOK',
  'MANUAL',
]);
export type PaymentRail = z.infer<typeof PaymentRailSchema>;

// Merchant information
export const MerchantInfoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  categoryCode: z.string().nullable(),
  country: z.string().nullable(),
  website: z.string().url().nullable(),
  
  // Risk indicators
  isVerified: z.boolean().default(false),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']).default('UNKNOWN'),
  
  // Metadata
  metadata: z.record(z.unknown()).default({}),
});
export type MerchantInfo = z.infer<typeof MerchantInfoSchema>;

// Transaction request input
export const TransactionRequestInputSchema = z.object({
  // Agent
  agentDid: z.string(),
  
  // Transaction details
  type: TransactionTypeSchema.default('PAYMENT'),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  
  // Merchant
  merchant: MerchantInfoSchema,
  
  // Description
  description: z.string().max(1000).nullable(),
  reasoningTrace: z.string().max(5000).nullable(),
  
  // Delegation chain (array of signed JWTs)
  delegationChain: z.array(z.string()).default([]),
  
  // Payment rail preference
  preferredRail: PaymentRailSchema.optional(),
  
  // Idempotency
  idempotencyKey: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.unknown()).default({}),
});
export type TransactionRequestInput = z.infer<typeof TransactionRequestInputSchema>;

// Transaction request (stored)
export const TransactionRequestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  agentDid: z.string(),
  
  // Transaction details
  type: TransactionTypeSchema,
  amount: z.number(),
  currency: z.string(),
  
  // Merchant
  merchant: MerchantInfoSchema,
  
  // Description
  description: z.string().nullable(),
  reasoningTrace: z.string().nullable(),
  
  // Delegation
  delegationChainTokenIds: z.array(z.string()),
  delegationDepth: z.number(),
  rootIssuerDid: z.string().nullable(),
  
  // Status
  status: TransactionStatusSchema,
  
  // Policy evaluation
  policyEvaluation: PolicyEvaluationResultSchema.nullable(),
  riskScore: z.number().min(0).max(100),
  
  // Mandate (if approved)
  mandateId: z.string().nullable(),
  mandateToken: z.string().nullable(),
  mandateExpiresAt: z.date().nullable(),
  
  // Execution
  paymentRail: PaymentRailSchema.nullable(),
  paymentRailTransactionId: z.string().nullable(),
  executedAt: z.date().nullable(),
  executionError: z.string().nullable(),
  
  // Review
  requiresReview: z.boolean().default(false),
  reviewedAt: z.date().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewNotes: z.string().nullable(),
  
  // Idempotency
  idempotencyKey: z.string().nullable(),
  
  // Metadata
  metadata: z.record(z.unknown()).default({}),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  decidedAt: z.date().nullable(),
});
export type TransactionRequest = z.infer<typeof TransactionRequestSchema>;

// Mandate payload (JWT)
export const MandatePayloadSchema = z.object({
  // Standard JWT claims
  iss: z.string(), // Guthwine DID
  sub: z.string(), // Agent DID
  aud: z.string(), // Merchant ID or payment rail
  iat: z.number(),
  exp: z.number(),
  jti: z.string(), // Mandate ID
  
  // Guthwine-specific claims
  guthwine: z.object({
    type: z.literal('TRANSACTION_MANDATE'),
    version: z.number(),
    organizationId: z.string(),
    transactionId: z.string(),
    
    // Transaction details
    amount: z.number(),
    currency: z.string(),
    merchantId: z.string(),
    merchantName: z.string().nullable(),
    
    // Authorization
    delegationChainHash: z.string(),
    policySnapshotHash: z.string(),
    riskScore: z.number(),
    
    // Constraints
    maxExecutions: z.number().default(1),
    validPaymentRails: z.array(PaymentRailSchema),
  }),
});
export type MandatePayload = z.infer<typeof MandatePayloadSchema>;

// Transaction response
export const TransactionResponseSchema = z.object({
  transactionId: z.string(),
  status: TransactionStatusSchema,
  
  // Decision
  decision: z.enum(['APPROVED', 'DENIED', 'REQUIRES_REVIEW']),
  reason: z.string(),
  
  // Mandate (if approved)
  mandate: z.object({
    id: z.string(),
    token: z.string(),
    expiresAt: z.date(),
  }).nullable(),
  
  // Policy details
  policyViolations: z.array(z.string()),
  matchedPolicies: z.array(z.object({
    id: z.string(),
    name: z.string(),
    action: z.string(),
  })),
  
  // Risk
  riskScore: z.number(),
  riskFactors: z.array(z.object({
    factor: z.string(),
    score: z.number(),
    description: z.string(),
  })),
  
  // Semantic evaluation
  semanticEvaluation: z.object({
    evaluated: z.boolean(),
    compliant: z.boolean().nullable(),
    confidence: z.number().nullable(),
    reasoning: z.string().nullable(),
  }).nullable(),
  
  // Metadata
  evaluationTimeMs: z.number(),
  auditLogId: z.string(),
});
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;

// Transaction execution input
export const ExecuteTransactionInputSchema = z.object({
  transactionId: z.string().uuid(),
  mandateToken: z.string(),
  paymentRail: PaymentRailSchema,
  
  // Rail-specific parameters
  railParams: z.record(z.unknown()).default({}),
});
export type ExecuteTransactionInput = z.infer<typeof ExecuteTransactionInputSchema>;

// Transaction execution result
export const TransactionExecutionResultSchema = z.object({
  success: z.boolean(),
  transactionId: z.string(),
  
  // Rail response
  paymentRail: PaymentRailSchema,
  railTransactionId: z.string().nullable(),
  railResponse: z.record(z.unknown()).nullable(),
  
  // Error
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).nullable(),
  
  // Timestamps
  executedAt: z.date(),
  executionTimeMs: z.number(),
});
export type TransactionExecutionResult = z.infer<typeof TransactionExecutionResultSchema>;

// Transaction reconciliation
export const TransactionReconciliationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  transactionId: z.string().uuid(),
  
  // Expected vs actual
  expectedAmount: z.number(),
  actualAmount: z.number().nullable(),
  amountDiscrepancy: z.number().nullable(),
  
  // Status
  status: z.enum(['PENDING', 'MATCHED', 'DISCREPANCY', 'MISSING', 'DUPLICATE']),
  
  // Rail data
  paymentRail: PaymentRailSchema,
  railTransactionId: z.string().nullable(),
  railSettledAt: z.date().nullable(),
  
  // Resolution
  resolvedAt: z.date().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolution: z.string().nullable(),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TransactionReconciliation = z.infer<typeof TransactionReconciliationSchema>;
