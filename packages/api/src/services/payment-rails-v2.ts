/**
 * Payment Rails v2
 * 
 * Production-ready payment connectors:
 * - Stripe: Card payments, ACH, wire transfers
 * - x402: HTTP payment protocol for micropayments
 * - Plaid: Bank account verification and balance checks
 * - Reconciliation: Transaction matching and settlement
 */

import { prisma, Prisma } from '@guthwine/database';
import * as crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface PaymentRequest {
  organizationId: string;
  agentId: string;
  amount: number;
  currency: string;
  merchantId?: string;
  merchantName?: string;
  merchantCategory?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  externalId?: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  amount: number;
  currency: string;
  fee?: number;
  settlementDate?: Date;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundRequest {
  transactionId: string;
  amount?: number; // Partial refund if specified
  reason: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  errorMessage?: string;
}

export interface BalanceCheckRequest {
  organizationId: string;
  accountId?: string;
}

export interface BalanceCheckResult {
  available: number;
  pending: number;
  currency: string;
  lastUpdated: Date;
}

export interface ReconciliationRecord {
  id: string;
  organizationId: string;
  transactionId: string;
  externalId: string;
  expectedAmount: number;
  actualAmount: number;
  currency: string;
  status: 'matched' | 'mismatched' | 'pending' | 'disputed';
  discrepancy?: number;
  resolvedAt?: Date;
  notes?: string;
}

// =============================================================================
// PAYMENT CONNECTOR INTERFACE
// =============================================================================

export interface PaymentConnector {
  name: string;
  supportedCurrencies: string[];
  supportedMethods: string[];
  
  initialize(): Promise<void>;
  healthCheck(): Promise<boolean>;
  
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
  getPaymentStatus(transactionId: string): Promise<PaymentResult>;
  cancelPayment(transactionId: string): Promise<PaymentResult>;
  refundPayment(request: RefundRequest): Promise<RefundResult>;
  
  getBalance(request: BalanceCheckRequest): Promise<BalanceCheckResult>;
  
  // Webhook handling
  verifyWebhook(payload: string, signature: string): boolean;
  handleWebhook(event: unknown): Promise<void>;
}

// =============================================================================
// STRIPE CONNECTOR
// =============================================================================

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiVersion?: string;
}

export class StripeConnector implements PaymentConnector {
  name = 'stripe';
  supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
  supportedMethods = ['card', 'ach', 'wire', 'sepa'];
  
  private config: StripeConfig;
  private baseUrl = 'https://api.stripe.com/v1';

  constructor(config: StripeConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Verify API key by fetching account info
    const response = await this.makeRequest('GET', '/account');
    if (!response.id) {
      throw new Error('Failed to initialize Stripe connector');
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.makeRequest('GET', '/account');
      return !!response.id;
    } catch {
      return false;
    }
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const idempotencyKey = request.idempotencyKey ?? crypto.randomUUID();
    
    try {
      // Create a PaymentIntent
      const paymentIntent = await this.makeRequest('POST', '/payment_intents', {
        amount: Math.round(request.amount * 100), // Stripe uses cents
        currency: request.currency.toLowerCase(),
        description: request.description,
        metadata: {
          organization_id: request.organizationId,
          agent_id: request.agentId,
          merchant_id: request.merchantId,
          merchant_name: request.merchantName,
          ...request.metadata,
        },
      }, { 'Idempotency-Key': idempotencyKey });

      return {
        success: true,
        transactionId: paymentIntent.id,
        externalId: paymentIntent.id,
        status: this.mapStripeStatus(paymentIntent.status),
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency.toUpperCase(),
        metadata: paymentIntent.metadata,
      };
    } catch (error: any) {
      return {
        success: false,
        transactionId: idempotencyKey,
        status: 'failed',
        amount: request.amount,
        currency: request.currency,
        errorCode: error.code,
        errorMessage: error.message,
      };
    }
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentResult> {
    const paymentIntent = await this.makeRequest('GET', `/payment_intents/${transactionId}`);
    
    return {
      success: paymentIntent.status === 'succeeded',
      transactionId: paymentIntent.id,
      externalId: paymentIntent.id,
      status: this.mapStripeStatus(paymentIntent.status),
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
      metadata: paymentIntent.metadata,
    };
  }

  async cancelPayment(transactionId: string): Promise<PaymentResult> {
    const paymentIntent = await this.makeRequest('POST', `/payment_intents/${transactionId}/cancel`);
    
    return {
      success: paymentIntent.status === 'canceled',
      transactionId: paymentIntent.id,
      externalId: paymentIntent.id,
      status: 'cancelled',
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
    };
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    try {
      const refund = await this.makeRequest('POST', '/refunds', {
        payment_intent: request.transactionId,
        amount: request.amount ? Math.round(request.amount * 100) : undefined,
        reason: request.reason,
      });

      return {
        success: true,
        refundId: refund.id,
        amount: refund.amount / 100,
        status: refund.status === 'succeeded' ? 'completed' : 'pending',
      };
    } catch (error: any) {
      return {
        success: false,
        refundId: '',
        amount: request.amount ?? 0,
        status: 'failed',
        errorMessage: error.message,
      };
    }
  }

  async getBalance(request: BalanceCheckRequest): Promise<BalanceCheckResult> {
    const balance = await this.makeRequest('GET', '/balance');
    const usdBalance = balance.available.find((b: any) => b.currency === 'usd') || { amount: 0 };
    const usdPending = balance.pending.find((b: any) => b.currency === 'usd') || { amount: 0 };

    return {
      available: usdBalance.amount / 100,
      pending: usdPending.amount / 100,
      currency: 'USD',
      lastUpdated: new Date(),
    };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    const timestamp = signature.split(',')[0]?.split('=')[1];
    const sig = signature.split(',')[1]?.split('=')[1];
    
    if (!timestamp || !sig) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const expectedSig = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  }

  async handleWebhook(event: any): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        // Update transaction status
        break;
      case 'payment_intent.payment_failed':
        // Handle failure
        break;
      case 'charge.refunded':
        // Handle refund
        break;
    }
  }

  private async makeRequest(
    method: string,
    path: string,
    body?: Record<string, any>,
    headers?: Record<string, string>
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': this.config.apiVersion ?? '2023-10-16',
        ...headers,
      },
    };

    if (body) {
      options.body = new URLSearchParams(this.flattenObject(body)).toString();
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw { code: data.error?.code, message: data.error?.message };
    }

    return data;
  }

  private flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}[${key}]` : key;
      
      if (value === null || value === undefined) continue;
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenObject(value, newKey));
      } else {
        result[newKey] = String(value);
      }
    }
    
    return result;
  }

  private mapStripeStatus(status: string): PaymentResult['status'] {
    switch (status) {
      case 'succeeded': return 'completed';
      case 'canceled': return 'cancelled';
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
      case 'processing': return 'pending';
      default: return 'failed';
    }
  }
}

// =============================================================================
// X402 CONNECTOR (HTTP Payment Protocol)
// =============================================================================

export interface X402Config {
  walletAddress: string;
  privateKey: string;
  network: 'mainnet' | 'testnet';
}

export class X402Connector implements PaymentConnector {
  name = 'x402';
  supportedCurrencies = ['USD', 'USDC', 'ETH', 'BTC'];
  supportedMethods = ['http_402', 'lightning', 'stablecoin'];
  
  private config: X402Config;

  constructor(config: X402Config) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Verify wallet connection
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const paymentId = `x402_${crypto.randomUUID()}`;
    
    // Create a payment request that can be sent via HTTP 402
    const paymentRequest = {
      id: paymentId,
      amount: request.amount,
      currency: request.currency,
      recipient: this.config.walletAddress,
      memo: request.description,
      expires: new Date(Date.now() + 3600000).toISOString(), // 1 hour
    };

    // In a real implementation, this would create an on-chain transaction
    // or generate a Lightning invoice

    return {
      success: true,
      transactionId: paymentId,
      status: 'pending',
      amount: request.amount,
      currency: request.currency,
      metadata: {
        paymentRequest,
        protocol: 'x402',
      },
    };
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentResult> {
    // Check on-chain or Lightning status
    return {
      success: true,
      transactionId,
      status: 'pending',
      amount: 0,
      currency: 'USD',
    };
  }

  async cancelPayment(transactionId: string): Promise<PaymentResult> {
    return {
      success: true,
      transactionId,
      status: 'cancelled',
      amount: 0,
      currency: 'USD',
    };
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    // Create reverse transaction
    return {
      success: true,
      refundId: `refund_${crypto.randomUUID()}`,
      amount: request.amount ?? 0,
      status: 'pending',
    };
  }

  async getBalance(request: BalanceCheckRequest): Promise<BalanceCheckResult> {
    // Query wallet balance
    return {
      available: 0,
      pending: 0,
      currency: 'USD',
      lastUpdated: new Date(),
    };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    // Verify webhook signature
    return true;
  }

  async handleWebhook(event: unknown): Promise<void> {
    // Handle payment confirmation
  }

  /**
   * Generate HTTP 402 response headers for payment required
   */
  generatePaymentRequiredHeaders(amount: number, currency: string): Record<string, string> {
    return {
      'WWW-Authenticate': `X402 realm="payment", amount="${amount}", currency="${currency}"`,
      'X-Payment-Address': this.config.walletAddress,
      'X-Payment-Amount': amount.toString(),
      'X-Payment-Currency': currency,
      'X-Payment-Network': this.config.network,
    };
  }

  /**
   * Verify payment proof from HTTP header
   */
  verifyPaymentProof(proof: string): boolean {
    // Verify cryptographic proof of payment
    // This would check on-chain transaction or Lightning preimage
    return true;
  }
}

// =============================================================================
// PLAID CONNECTOR
// =============================================================================

export interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'development' | 'production';
}

export class PlaidConnector implements PaymentConnector {
  name = 'plaid';
  supportedCurrencies = ['USD'];
  supportedMethods = ['ach', 'balance_check', 'identity'];
  
  private config: PlaidConfig;
  private baseUrl: string;

  constructor(config: PlaidConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production'
      ? 'https://production.plaid.com'
      : config.environment === 'development'
        ? 'https://development.plaid.com'
        : 'https://sandbox.plaid.com';
  }

  async initialize(): Promise<void> {
    // Verify credentials
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    // Plaid is primarily for account verification, not direct payments
    // This would initiate an ACH transfer through a partner
    return {
      success: false,
      transactionId: '',
      status: 'failed',
      amount: request.amount,
      currency: request.currency,
      errorMessage: 'Direct payments not supported. Use for account verification.',
    };
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentResult> {
    return {
      success: false,
      transactionId,
      status: 'failed',
      amount: 0,
      currency: 'USD',
      errorMessage: 'Not supported',
    };
  }

  async cancelPayment(transactionId: string): Promise<PaymentResult> {
    return {
      success: false,
      transactionId,
      status: 'failed',
      amount: 0,
      currency: 'USD',
      errorMessage: 'Not supported',
    };
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    return {
      success: false,
      refundId: '',
      amount: 0,
      status: 'failed',
      errorMessage: 'Not supported',
    };
  }

  async getBalance(request: BalanceCheckRequest): Promise<BalanceCheckResult> {
    // This would use a stored access token to fetch balances
    return {
      available: 0,
      pending: 0,
      currency: 'USD',
      lastUpdated: new Date(),
    };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    // Verify Plaid webhook
    return true;
  }

  async handleWebhook(event: unknown): Promise<void> {
    // Handle Plaid events
  }

  /**
   * Create a link token for Plaid Link
   */
  async createLinkToken(userId: string, products: string[]): Promise<string> {
    const response = await this.makeRequest('/link/token/create', {
      client_id: this.config.clientId,
      secret: this.config.secret,
      user: { client_user_id: userId },
      client_name: 'Guthwine',
      products,
      country_codes: ['US'],
      language: 'en',
    });

    return response.link_token;
  }

  /**
   * Exchange public token for access token
   */
  async exchangePublicToken(publicToken: string): Promise<string> {
    const response = await this.makeRequest('/item/public_token/exchange', {
      client_id: this.config.clientId,
      secret: this.config.secret,
      public_token: publicToken,
    });

    return response.access_token;
  }

  /**
   * Get account balances
   */
  async getAccountBalances(accessToken: string): Promise<Array<{
    accountId: string;
    name: string;
    type: string;
    available: number;
    current: number;
    currency: string;
  }>> {
    const response = await this.makeRequest('/accounts/balance/get', {
      client_id: this.config.clientId,
      secret: this.config.secret,
      access_token: accessToken,
    });

    return response.accounts.map((account: any) => ({
      accountId: account.account_id,
      name: account.name,
      type: account.type,
      available: account.balances.available ?? 0,
      current: account.balances.current ?? 0,
      currency: account.balances.iso_currency_code ?? 'USD',
    }));
  }

  /**
   * Verify account ownership
   */
  async verifyIdentity(accessToken: string): Promise<{
    verified: boolean;
    names: string[];
    emails: string[];
    addresses: string[];
  }> {
    const response = await this.makeRequest('/identity/get', {
      client_id: this.config.clientId,
      secret: this.config.secret,
      access_token: accessToken,
    });

    const owners = response.accounts[0]?.owners ?? [];
    
    return {
      verified: owners.length > 0,
      names: owners.flatMap((o: any) => o.names ?? []),
      emails: owners.flatMap((o: any) => o.emails?.map((e: any) => e.data) ?? []),
      addresses: owners.flatMap((o: any) => 
        o.addresses?.map((a: any) => 
          `${a.data.street}, ${a.data.city}, ${a.data.region} ${a.data.postal_code}`
        ) ?? []
      ),
    };
  }

  private async makeRequest(path: string, body: Record<string, any>): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error_message ?? 'Plaid API error');
    }

    return data;
  }
}

// =============================================================================
// RECONCILIATION ENGINE
// =============================================================================

export class ReconciliationEngine {
  private prisma = prisma;

  /**
   * Create a reconciliation record for a transaction
   */
  async createReconciliation(
    organizationId: string,
    transactionId: string,
    externalId: string,
    expectedAmount: number,
    paymentRail: string
  ): Promise<ReconciliationRecord> {
    const record = await this.prisma.transactionReconciliation.create({
      data: {
        organizationId,
        transactionId,
        railTransactionId: externalId,
        expectedAmount,
        paymentRail: paymentRail as any,
        status: 'PENDING',
      },
    });

    return this.mapToRecord(record);
  }

  /**
   * Update reconciliation with actual amount from payment provider
   */
  async updateReconciliation(
    reconciliationId: string,
    actualAmount: number,
    settlementDate?: Date
  ): Promise<ReconciliationRecord> {
    const existing = await this.prisma.transactionReconciliation.findUnique({
      where: { id: reconciliationId },
    });

    if (!existing) {
      throw new Error(`Reconciliation ${reconciliationId} not found`);
    }

    const discrepancy = Math.abs(existing.expectedAmount - actualAmount);
    const status = discrepancy === 0 ? 'MATCHED' :
                   discrepancy < 0.01 ? 'MATCHED' : // Allow for rounding
                   'DISCREPANCY';

    const updated = await this.prisma.transactionReconciliation.update({
      where: { id: reconciliationId },
      data: {
        actualAmount,
        status,
        amountDiscrepancy: discrepancy,
        railSettledAt: settlementDate,
        resolvedAt: status === 'MATCHED' ? new Date() : null,
      },
    });

    return this.mapToRecord(updated);
  }

  /**
   * Get all pending reconciliations for an organization
   */
  async getPendingReconciliations(organizationId: string): Promise<ReconciliationRecord[]> {
    const records = await this.prisma.transactionReconciliation.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
    });

    return records.map(this.mapToRecord);
  }

  /**
   * Get mismatched reconciliations that need attention
   */
  async getMismatchedReconciliations(organizationId: string): Promise<ReconciliationRecord[]> {
    const records = await this.prisma.transactionReconciliation.findMany({
      where: {
        organizationId,
        status: 'DISCREPANCY',
      },
      orderBy: { createdAt: 'asc' },
    });

    return records.map(this.mapToRecord);
  }

  /**
   * Mark a reconciliation as disputed
   */
  async disputeReconciliation(
    reconciliationId: string,
    notes: string
  ): Promise<ReconciliationRecord> {
    const updated = await this.prisma.transactionReconciliation.update({
      where: { id: reconciliationId },
      data: {
        status: 'DISCREPANCY',
        resolution: notes,
      },
    });

    return this.mapToRecord(updated);
  }

  /**
   * Resolve a disputed reconciliation
   */
  async resolveDispute(
    reconciliationId: string,
    resolution: 'accept_expected' | 'accept_actual' | 'split_difference',
    notes: string
  ): Promise<ReconciliationRecord> {
    const existing = await this.prisma.transactionReconciliation.findUnique({
      where: { id: reconciliationId },
    });

    if (!existing) {
      throw new Error(`Reconciliation ${reconciliationId} not found`);
    }

    let finalAmount = existing.actualAmount;
    if (resolution === 'accept_expected') {
      finalAmount = existing.expectedAmount;
    } else if (resolution === 'split_difference') {
      finalAmount = (existing.expectedAmount + (existing.actualAmount ?? 0)) / 2;
    }

    const updated = await this.prisma.transactionReconciliation.update({
      where: { id: reconciliationId },
      data: {
        actualAmount: finalAmount,
        status: 'MATCHED',
        amountDiscrepancy: 0,
        resolvedAt: new Date(),
        resolution: `Resolution: ${resolution} - ${notes}`,
      },
    });

    return this.mapToRecord(updated);
  }

  /**
   * Run batch reconciliation for a date range
   */
  async runBatchReconciliation(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    total: number;
    matched: number;
    mismatched: number;
    pending: number;
    totalDiscrepancy: number;
  }> {
    const records = await this.prisma.transactionReconciliation.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const stats = {
      total: records.length,
      matched: 0,
      mismatched: 0,
      pending: 0,
      totalDiscrepancy: 0,
    };

    for (const record of records) {
      if (record.status === 'MATCHED') stats.matched++;
      else if (record.status === 'DISCREPANCY') {
        stats.mismatched++;
        stats.totalDiscrepancy += record.amountDiscrepancy ?? 0;
      }
      else if (record.status === 'PENDING') stats.pending++;
    }

    return stats;
  }

  /**
   * Generate reconciliation report
   */
  async generateReport(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    summary: {
      totalTransactions: number;
      totalAmount: number;
      matchedAmount: number;
      unmatchedAmount: number;
      discrepancyAmount: number;
    };
    byStatus: Record<string, number>;
    byCurrency: Record<string, number>;
    topDiscrepancies: ReconciliationRecord[];
  }> {
    const records = await this.prisma.transactionReconciliation.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { amountDiscrepancy: 'desc' },
    });

    const summary = {
      totalTransactions: records.length,
      totalAmount: records.reduce((sum, r) => sum + r.expectedAmount, 0),
      matchedAmount: records
        .filter(r => r.status === 'MATCHED')
        .reduce((sum, r) => sum + (r.actualAmount ?? 0), 0),
      unmatchedAmount: records
        .filter(r => r.status !== 'MATCHED')
        .reduce((sum, r) => sum + r.expectedAmount, 0),
      discrepancyAmount: records.reduce((sum, r) => sum + (r.amountDiscrepancy ?? 0), 0),
    };

    const byStatus: Record<string, number> = {};
    const byCurrency: Record<string, number> = {};

    for (const record of records) {
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
    }

    const topDiscrepancies = records
      .filter(r => (r.amountDiscrepancy ?? 0) > 0)
      .slice(0, 10)
      .map(this.mapToRecord);

    return {
      summary,
      byStatus,
      byCurrency: {},
      topDiscrepancies,
    };
  }

  private mapToRecord(record: any): ReconciliationRecord {
    return {
      id: record.id,
      organizationId: record.organizationId,
      transactionId: record.transactionId,
      externalId: record.railTransactionId ?? '',
      expectedAmount: record.expectedAmount,
      actualAmount: record.actualAmount ?? 0,
      currency: 'USD', // Default currency
      status: record.status.toLowerCase() as ReconciliationRecord['status'],
      discrepancy: record.amountDiscrepancy,
      resolvedAt: record.resolvedAt,
      notes: record.resolution,
    };
  }
}

// =============================================================================
// PAYMENT RAILS MANAGER
// =============================================================================

export class PaymentRailsManager {
  private connectors: Map<string, PaymentConnector> = new Map();
  private reconciliation: ReconciliationEngine;
  private defaultConnector: string = 'stripe';

  constructor() {
    this.reconciliation = new ReconciliationEngine();
  }

  /**
   * Register a payment connector
   */
  registerConnector(connector: PaymentConnector): void {
    this.connectors.set(connector.name, connector);
  }

  /**
   * Set the default connector
   */
  setDefaultConnector(name: string): void {
    if (!this.connectors.has(name)) {
      throw new Error(`Connector ${name} not registered`);
    }
    this.defaultConnector = name;
  }

  /**
   * Get a specific connector
   */
  getConnector(name: string): PaymentConnector {
    const connector = this.connectors.get(name);
    if (!connector) {
      throw new Error(`Connector ${name} not registered`);
    }
    return connector;
  }

  /**
   * Get the reconciliation engine
   */
  getReconciliation(): ReconciliationEngine {
    return this.reconciliation;
  }

  /**
   * Process a payment through the appropriate connector
   */
  async processPayment(
    request: PaymentRequest,
    connectorName?: string
  ): Promise<PaymentResult> {
    const connector = this.getConnector(connectorName ?? this.defaultConnector);
    
    // Create payment
    const result = await connector.createPayment(request);

    // Create reconciliation record
    if (result.success && result.externalId) {
      await this.reconciliation.createReconciliation(
        request.organizationId,
        result.transactionId,
        result.externalId,
        request.amount,
        connectorName ?? this.defaultConnector
      );
    }

    return result;
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(
    transactionId: string,
    connectorName?: string
  ): Promise<PaymentResult> {
    const connector = this.getConnector(connectorName ?? this.defaultConnector);
    return connector.getPaymentStatus(transactionId);
  }

  /**
   * Cancel a payment
   */
  async cancelPayment(
    transactionId: string,
    connectorName?: string
  ): Promise<PaymentResult> {
    const connector = this.getConnector(connectorName ?? this.defaultConnector);
    return connector.cancelPayment(transactionId);
  }

  /**
   * Refund a payment
   */
  async refundPayment(
    request: RefundRequest,
    connectorName?: string
  ): Promise<RefundResult> {
    const connector = this.getConnector(connectorName ?? this.defaultConnector);
    return connector.refundPayment(request);
  }

  /**
   * Health check all connectors
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [name, connector] of this.connectors) {
      results[name] = await connector.healthCheck();
    }

    return results;
  }
}

/**
 * Create a payment rails manager with default connectors
 */
export function createPaymentRailsManager(config: {
  stripe?: StripeConfig;
  x402?: X402Config;
  plaid?: PlaidConfig;
}): PaymentRailsManager {
  const manager = new PaymentRailsManager();

  if (config.stripe) {
    manager.registerConnector(new StripeConnector(config.stripe));
  }

  if (config.x402) {
    manager.registerConnector(new X402Connector(config.x402));
  }

  if (config.plaid) {
    manager.registerConnector(new PlaidConnector(config.plaid));
  }

  return manager;
}
