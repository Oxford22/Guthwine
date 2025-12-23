/**
 * Guthwine TypeScript SDK
 * Client library for AI agent integration
 */

// =============================================================================
// TYPES
// =============================================================================

export interface GuthwineConfig {
  baseUrl: string;
  apiKey?: string;
  sessionToken?: string;
  timeout?: number;
  retries?: number;
  onError?: (error: GuthwineError) => void;
}

export interface GuthwineError extends Error {
  code: string;
  status?: number;
  details?: Record<string, unknown>;
}

export interface CreateAgentOptions {
  name: string;
  type?: 'PRIMARY' | 'DELEGATED' | 'SERVICE' | 'EPHEMERAL';
  parentAgentId?: string;
  capabilities?: {
    canDelegate?: boolean;
    canTransact?: boolean;
    maxDelegationDepth?: number;
  };
  spendingLimits?: {
    maxPerTransaction?: number;
    maxDaily?: number;
    maxWeekly?: number;
    maxMonthly?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  did: string;
  name: string;
  type: string;
  status: string;
  publicKey: string;
  createdAt: Date;
}

export interface AuthorizeTransactionOptions {
  agentDid: string;
  amount: number;
  currency?: string;
  merchantId: string;
  merchantName?: string;
  merchantCategory?: string;
  reasoningTrace?: string;
  delegationChain?: string[];
  metadata?: Record<string, unknown>;
}

export interface TransactionAuthorizationResult {
  transactionId: string;
  status: 'APPROVED' | 'DENIED' | 'REQUIRES_REVIEW';
  decision: string;
  reason: string;
  mandateToken?: string;
  mandateExpiresAt?: Date;
  riskScore: number;
  policyViolations: string[];
}

export interface ExecuteTransactionOptions {
  transactionId: string;
  mandateToken: string;
  paymentRail: 'STRIPE' | 'COINBASE' | 'WISE' | 'PLAID' | 'WEBHOOK' | 'MANUAL';
  railParams?: Record<string, unknown>;
}

export interface TransactionExecutionResult {
  success: boolean;
  railTransactionId?: string;
  error?: string;
}

export interface DelegationConstraints {
  maxAmount?: number;
  allowedMerchants?: string[];
  blockedMerchants?: string[];
  allowedCategories?: string[];
  semanticConstraints?: string;
  expiresInSeconds?: number;
}

export interface CreateDelegationOptions {
  issuerAgentId: string;
  recipientAgentId: string;
  constraints: DelegationConstraints;
}

export interface Delegation {
  id: string;
  token: string;
  expiresAt: Date;
}

export interface AddPolicyOptions {
  agentId: string;
  name: string;
  description?: string;
  rules: Record<string, unknown>;
  priority?: number;
}

export interface Policy {
  id: string;
  name: string;
  description: string | null;
  rules: Record<string, unknown>;
  priority: number;
  isActive: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface AuditIntegrityResult {
  valid: boolean;
  totalLogs: number;
  verifiedLogs: number;
  errors: string[];
}

// =============================================================================
// SDK CLIENT
// =============================================================================

export class GuthwineClient {
  private config: GuthwineConfig;

  constructor(config: GuthwineConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // AGENTS
  // ---------------------------------------------------------------------------

  /**
   * Register a new agent
   */
  async createAgent(options: CreateAgentOptions): Promise<Agent> {
    return this.request<Agent>('POST', '/api/v2/agents', options);
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<Agent> {
    return this.request<Agent>('GET', `/api/v2/agents/${agentId}`);
  }

  /**
   * Freeze an agent (kill switch)
   */
  async freezeAgent(agentId: string, reason: string): Promise<void> {
    await this.request('POST', `/api/v2/agents/${agentId}/freeze`, { reason });
  }

  /**
   * Unfreeze an agent
   */
  async unfreezeAgent(agentId: string): Promise<void> {
    await this.request('POST', `/api/v2/agents/${agentId}/unfreeze`);
  }

  // ---------------------------------------------------------------------------
  // TRANSACTIONS
  // ---------------------------------------------------------------------------

  /**
   * Authorize a transaction
   */
  async authorizeTransaction(
    options: AuthorizeTransactionOptions
  ): Promise<TransactionAuthorizationResult> {
    return this.request<TransactionAuthorizationResult>(
      'POST',
      '/api/v2/transactions/authorize',
      options
    );
  }

  /**
   * Execute an approved transaction
   */
  async executeTransaction(
    options: ExecuteTransactionOptions
  ): Promise<TransactionExecutionResult> {
    return this.request<TransactionExecutionResult>(
      'POST',
      `/api/v2/transactions/${options.transactionId}/execute`,
      {
        mandateToken: options.mandateToken,
        paymentRail: options.paymentRail,
        railParams: options.railParams,
      }
    );
  }

  // ---------------------------------------------------------------------------
  // DELEGATIONS
  // ---------------------------------------------------------------------------

  /**
   * Create a delegation
   */
  async createDelegation(options: CreateDelegationOptions): Promise<Delegation> {
    return this.request<Delegation>('POST', '/api/v2/delegations', options);
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(delegationId: string, reason: string): Promise<void> {
    await this.request('DELETE', `/api/v2/delegations/${delegationId}`, { reason });
  }

  // ---------------------------------------------------------------------------
  // POLICIES
  // ---------------------------------------------------------------------------

  /**
   * Add a policy to an agent
   */
  async addPolicy(options: AddPolicyOptions): Promise<Policy> {
    return this.request<Policy>(
      'POST',
      `/api/v2/agents/${options.agentId}/policies`,
      {
        name: options.name,
        description: options.description,
        rules: options.rules,
        priority: options.priority,
      }
    );
  }

  /**
   * Get policies for an agent
   */
  async getPolicies(agentId: string): Promise<Policy[]> {
    return this.request<Policy[]>('GET', `/api/v2/agents/${agentId}/policies`);
  }

  // ---------------------------------------------------------------------------
  // AUDIT
  // ---------------------------------------------------------------------------

  /**
   * Get audit trail
   */
  async getAuditTrail(options?: {
    agentId?: string;
    transactionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (options?.agentId) params.set('agentId', options.agentId);
    if (options?.transactionId) params.set('transactionId', options.transactionId);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());

    const query = params.toString();
    return this.request<AuditLogEntry[]>('GET', `/api/v2/audit${query ? `?${query}` : ''}`);
  }

  /**
   * Verify audit integrity
   */
  async verifyAuditIntegrity(): Promise<AuditIntegrityResult> {
    return this.request<AuditIntegrityResult>('GET', '/api/v2/audit/verify');
  }

  // ---------------------------------------------------------------------------
  // GLOBAL CONTROLS
  // ---------------------------------------------------------------------------

  /**
   * Activate global freeze
   */
  async globalFreeze(reason: string): Promise<void> {
    await this.request('POST', '/api/v2/global/freeze', { reason });
  }

  /**
   * Deactivate global freeze
   */
  async globalUnfreeze(): Promise<void> {
    await this.request('POST', '/api/v2/global/unfreeze');
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }
    if (this.config.sessionToken) {
      headers['Authorization'] = `Bearer ${this.config.sessionToken}`;
    }

    let lastError: Error | null = null;
    const retries = this.config.retries || 3;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.timeout || 30000
        );

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
          const error = new Error(
            (errorData.error as string) || `HTTP ${response.status}`
          ) as GuthwineError;
          error.code = (errorData.code as string) || 'HTTP_ERROR';
          error.status = response.status;
          error.details = errorData;
          throw error;
        }

        return await response.json() as T;
      } catch (error) {
        lastError = error as Error;
        if (this.config.onError) {
          this.config.onError(error as GuthwineError);
        }

        // Don't retry on client errors
        if ((error as GuthwineError).status && (error as GuthwineError).status! < 500) {
          throw error;
        }

        // Wait before retrying
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default GuthwineClient;


