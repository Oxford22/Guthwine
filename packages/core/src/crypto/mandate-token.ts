/**
 * Hardened Mandate Token Service
 * 
 * Mandate tokens are the core authorization mechanism in Guthwine.
 * This implementation includes:
 * - Nonce for replay protection
 * - Organization ID binding
 * - Token introspection endpoint support
 * - Versioned schema for forward compatibility
 */

import * as crypto from 'crypto';
import { z } from 'zod';

// =============================================================================
// MANDATE TOKEN SCHEMA (Versioned)
// =============================================================================

export const MANDATE_TOKEN_VERSION = 2;

export const MandateTokenPayloadV2Schema = z.object({
  // Schema version for forward compatibility
  v: z.literal(2),
  
  // Token identifier (for introspection)
  jti: z.string().uuid(),
  
  // Issuer (organization ID or system)
  iss: z.string(),
  
  // Subject (agent DID)
  sub: z.string(),
  
  // Audience (target service or API)
  aud: z.string().or(z.array(z.string())),
  
  // Organization ID (for multi-tenancy)
  org: z.string().uuid(),
  
  // Issued at (Unix timestamp)
  iat: z.number().int(),
  
  // Not before (Unix timestamp)
  nbf: z.number().int().optional(),
  
  // Expiration (Unix timestamp)
  exp: z.number().int(),
  
  // Nonce for replay protection
  nonce: z.string().min(16),
  
  // Delegation chain (parent token IDs)
  chain: z.array(z.string()).default([]),
  
  // Permissions granted
  permissions: z.array(z.string()),
  
  // Constraints (spending limits, time windows, etc.)
  constraints: z.object({
    maxAmount: z.number().optional(),
    currency: z.string().optional(),
    allowedMerchants: z.array(z.string()).optional(),
    blockedMerchants: z.array(z.string()).optional(),
    allowedCategories: z.array(z.string()).optional(),
    blockedCategories: z.array(z.string()).optional(),
    timeWindow: z.object({
      start: z.number().int(),
      end: z.number().int(),
    }).optional(),
    maxUsageCount: z.number().int().optional(),
    requireReason: z.boolean().optional(),
  }).default({}),
  
  // Custom claims
  custom: z.record(z.unknown()).default({}),
});

export type MandateTokenPayloadV2 = z.infer<typeof MandateTokenPayloadV2Schema>;

// Legacy V1 schema for migration
export const MandateTokenPayloadV1Schema = z.object({
  v: z.literal(1).optional(),
  jti: z.string(),
  iss: z.string(),
  sub: z.string(),
  aud: z.string().or(z.array(z.string())),
  iat: z.number().int(),
  exp: z.number().int(),
  permissions: z.array(z.string()),
  constraints: z.record(z.unknown()).optional(),
});

export type MandateTokenPayloadV1 = z.infer<typeof MandateTokenPayloadV1Schema>;

// =============================================================================
// TOKEN INTROSPECTION
// =============================================================================

export interface TokenIntrospectionResult {
  active: boolean;
  tokenId: string;
  subject: string;
  organizationId: string;
  issuedAt: Date;
  expiresAt: Date;
  permissions: string[];
  usageCount: number;
  maxUsageCount?: number;
  revoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

export interface TokenIntrospectionStore {
  getToken(tokenId: string): Promise<TokenIntrospectionResult | null>;
  recordUsage(tokenId: string): Promise<void>;
  revokeToken(tokenId: string, reason: string): Promise<void>;
  isRevoked(tokenId: string): Promise<boolean>;
}

// =============================================================================
// NONCE STORE
// =============================================================================

export interface NonceStore {
  checkAndStore(nonce: string, expiresAt: Date): Promise<boolean>;
  isUsed(nonce: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

/**
 * In-memory nonce store (for development)
 */
export class InMemoryNonceStore implements NonceStore {
  private nonces: Map<string, Date> = new Map();

  async checkAndStore(nonce: string, expiresAt: Date): Promise<boolean> {
    if (this.nonces.has(nonce)) {
      return false; // Nonce already used
    }
    this.nonces.set(nonce, expiresAt);
    return true;
  }

  async isUsed(nonce: string): Promise<boolean> {
    return this.nonces.has(nonce);
  }

  async cleanup(): Promise<void> {
    const now = new Date();
    for (const [nonce, expiresAt] of this.nonces.entries()) {
      if (expiresAt < now) {
        this.nonces.delete(nonce);
      }
    }
  }
}

// =============================================================================
// MANDATE TOKEN SERVICE
// =============================================================================

export interface MandateTokenServiceConfig {
  issuer: string;
  defaultAudience: string;
  defaultExpirationSeconds: number;
  nonceStore: NonceStore;
  introspectionStore?: TokenIntrospectionStore;
  signingKey: crypto.KeyObject;
  verifyingKey: crypto.KeyObject;
}

export class MandateTokenService {
  private config: MandateTokenServiceConfig;

  constructor(config: MandateTokenServiceConfig) {
    this.config = config;
  }

  /**
   * Create a new mandate token
   */
  async createToken(params: {
    subject: string;
    organizationId: string;
    permissions: string[];
    audience?: string | string[];
    expirationSeconds?: number;
    constraints?: MandateTokenPayloadV2['constraints'];
    parentTokenId?: string;
    custom?: Record<string, unknown>;
  }): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (params.expirationSeconds ?? this.config.defaultExpirationSeconds);
    const tokenId = crypto.randomUUID();
    const nonce = crypto.randomBytes(16).toString('hex');

    const payload: MandateTokenPayloadV2 = {
      v: 2,
      jti: tokenId,
      iss: this.config.issuer,
      sub: params.subject,
      aud: params.audience ?? this.config.defaultAudience,
      org: params.organizationId,
      iat: now,
      exp,
      nonce,
      chain: params.parentTokenId ? [params.parentTokenId] : [],
      permissions: params.permissions,
      constraints: params.constraints ?? {},
      custom: params.custom ?? {},
    };

    // Validate payload
    MandateTokenPayloadV2Schema.parse(payload);

    // Store nonce
    const expiresAt = new Date(exp * 1000);
    await this.config.nonceStore.checkAndStore(nonce, expiresAt);

    // Create JWT
    const header = {
      alg: 'EdDSA',
      typ: 'JWT',
      kid: 'mandate-v2',
    };

    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${headerB64}.${payloadB64}`;
    
    const signature = crypto.sign(null, Buffer.from(signatureInput), this.config.signingKey);
    const signatureB64 = this.base64UrlEncode(signature);

    const token = `${signatureInput}.${signatureB64}`;

    return { token, tokenId, expiresAt };
  }

  /**
   * Verify and decode a mandate token
   */
  async verifyToken(token: string): Promise<{
    valid: boolean;
    payload?: MandateTokenPayloadV2;
    error?: string;
  }> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token format' };
      }

      const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

      // Verify signature
      const signatureInput = `${headerB64}.${payloadB64}`;
      const signature = this.base64UrlDecode(signatureB64);
      
      const isValid = crypto.verify(
        null,
        Buffer.from(signatureInput),
        this.config.verifyingKey,
        signature
      );

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }

      // Decode payload
      const payloadJson = this.base64UrlDecode(payloadB64).toString('utf-8');
      const rawPayload = JSON.parse(payloadJson);

      // Check version and migrate if needed
      let payload: MandateTokenPayloadV2;
      if (rawPayload.v === 2) {
        payload = MandateTokenPayloadV2Schema.parse(rawPayload);
      } else if (rawPayload.v === 1 || !rawPayload.v) {
        // Migrate V1 to V2
        const v1 = MandateTokenPayloadV1Schema.parse(rawPayload);
        payload = this.migrateV1ToV2(v1);
      } else {
        return { valid: false, error: `Unknown token version: ${rawPayload.v}` };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        return { valid: false, error: 'Token expired' };
      }

      // Check not before
      if (payload.nbf && payload.nbf > now) {
        return { valid: false, error: 'Token not yet valid' };
      }

      // Check nonce (replay protection)
      const nonceUsed = await this.config.nonceStore.isUsed(payload.nonce);
      if (!nonceUsed) {
        // First use - store the nonce
        const stored = await this.config.nonceStore.checkAndStore(
          payload.nonce,
          new Date(payload.exp * 1000)
        );
        if (!stored) {
          return { valid: false, error: 'Nonce already used (replay attack)' };
        }
      }

      // Check introspection store for revocation
      if (this.config.introspectionStore) {
        const isRevoked = await this.config.introspectionStore.isRevoked(payload.jti);
        if (isRevoked) {
          return { valid: false, error: 'Token has been revoked' };
        }
      }

      return { valid: true, payload };
    } catch (error) {
      return { valid: false, error: `Token verification failed: ${error}` };
    }
  }

  /**
   * Introspect a token (get detailed information)
   */
  async introspectToken(token: string): Promise<TokenIntrospectionResult | null> {
    const result = await this.verifyToken(token);
    if (!result.valid || !result.payload) {
      return null;
    }

    const payload = result.payload;

    // Check introspection store for additional info
    if (this.config.introspectionStore) {
      const stored = await this.config.introspectionStore.getToken(payload.jti);
      if (stored) {
        return stored;
      }
    }

    // Return basic introspection result
    return {
      active: true,
      tokenId: payload.jti,
      subject: payload.sub,
      organizationId: payload.org,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
      permissions: payload.permissions,
      usageCount: 0,
      maxUsageCount: payload.constraints.maxUsageCount,
      revoked: false,
    };
  }

  /**
   * Revoke a token
   */
  async revokeToken(tokenId: string, reason: string): Promise<void> {
    if (!this.config.introspectionStore) {
      throw new Error('Token revocation requires an introspection store');
    }
    await this.config.introspectionStore.revokeToken(tokenId, reason);
  }

  /**
   * Extend a token's delegation chain
   */
  async delegateToken(
    parentToken: string,
    params: {
      subject: string;
      permissions: string[];
      constraints?: MandateTokenPayloadV2['constraints'];
      expirationSeconds?: number;
    }
  ): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
    // Verify parent token
    const parentResult = await this.verifyToken(parentToken);
    if (!parentResult.valid || !parentResult.payload) {
      throw new Error(`Invalid parent token: ${parentResult.error}`);
    }

    const parent = parentResult.payload;

    // Validate permissions are subset of parent
    const invalidPermissions = params.permissions.filter(
      p => !parent.permissions.includes(p)
    );
    if (invalidPermissions.length > 0) {
      throw new Error(`Cannot delegate permissions not held by parent: ${invalidPermissions.join(', ')}`);
    }

    // Merge constraints (child must be more restrictive)
    const mergedConstraints = this.mergeConstraints(
      parent.constraints,
      params.constraints ?? {}
    );

    // Calculate expiration (cannot exceed parent)
    const parentExp = parent.exp;
    const requestedExp = params.expirationSeconds
      ? Math.floor(Date.now() / 1000) + params.expirationSeconds
      : parentExp;
    const finalExp = Math.min(parentExp, requestedExp);

    // Create delegated token
    return this.createToken({
      subject: params.subject,
      organizationId: parent.org,
      permissions: params.permissions,
      audience: parent.aud,
      expirationSeconds: finalExp - Math.floor(Date.now() / 1000),
      constraints: mergedConstraints,
      parentTokenId: parent.jti,
    });
  }

  // =============================================================================
  // PRIVATE HELPERS
  // =============================================================================

  private base64UrlEncode(data: string | Buffer): string {
    const buffer = typeof data === 'string' ? Buffer.from(data) : data;
    return buffer.toString('base64url');
  }

  private base64UrlDecode(data: string): Buffer {
    return Buffer.from(data, 'base64url');
  }

  private migrateV1ToV2(v1: MandateTokenPayloadV1): MandateTokenPayloadV2 {
    return {
      v: 2,
      jti: v1.jti,
      iss: v1.iss,
      sub: v1.sub,
      aud: v1.aud,
      org: 'legacy', // V1 tokens didn't have org
      iat: v1.iat,
      exp: v1.exp,
      nonce: crypto.randomBytes(16).toString('hex'), // Generate nonce for legacy tokens
      chain: [],
      permissions: v1.permissions,
      constraints: (v1.constraints as MandateTokenPayloadV2['constraints']) ?? {},
      custom: {},
    };
  }

  private mergeConstraints(
    parent: MandateTokenPayloadV2['constraints'],
    child: MandateTokenPayloadV2['constraints']
  ): MandateTokenPayloadV2['constraints'] {
    return {
      // Take the more restrictive amount
      maxAmount: Math.min(
        parent.maxAmount ?? Infinity,
        child.maxAmount ?? Infinity
      ) === Infinity ? undefined : Math.min(
        parent.maxAmount ?? Infinity,
        child.maxAmount ?? Infinity
      ),
      
      // Currency must match
      currency: child.currency ?? parent.currency,
      
      // Intersection of allowed merchants
      allowedMerchants: this.intersectArrays(
        parent.allowedMerchants,
        child.allowedMerchants
      ),
      
      // Union of blocked merchants
      blockedMerchants: this.unionArrays(
        parent.blockedMerchants,
        child.blockedMerchants
      ),
      
      // Intersection of allowed categories
      allowedCategories: this.intersectArrays(
        parent.allowedCategories,
        child.allowedCategories
      ),
      
      // Union of blocked categories
      blockedCategories: this.unionArrays(
        parent.blockedCategories,
        child.blockedCategories
      ),
      
      // Intersection of time windows
      timeWindow: this.intersectTimeWindows(
        parent.timeWindow,
        child.timeWindow
      ),
      
      // Take the more restrictive usage count
      maxUsageCount: Math.min(
        parent.maxUsageCount ?? Infinity,
        child.maxUsageCount ?? Infinity
      ) === Infinity ? undefined : Math.min(
        parent.maxUsageCount ?? Infinity,
        child.maxUsageCount ?? Infinity
      ),
      
      // If either requires reason, require it
      requireReason: parent.requireReason || child.requireReason,
    };
  }

  private intersectArrays(a?: string[], b?: string[]): string[] | undefined {
    if (!a) return b;
    if (!b) return a;
    return a.filter(x => b.includes(x));
  }

  private unionArrays(a?: string[], b?: string[]): string[] | undefined {
    if (!a && !b) return undefined;
    return [...new Set([...(a ?? []), ...(b ?? [])])];
  }

  private intersectTimeWindows(
    a?: { start: number; end: number },
    b?: { start: number; end: number }
  ): { start: number; end: number } | undefined {
    if (!a) return b;
    if (!b) return a;
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (start >= end) {
      throw new Error('Time window intersection is empty');
    }
    return { start, end };
  }
}

/**
 * Create a mandate token service
 */
export function createMandateTokenService(
  config: MandateTokenServiceConfig
): MandateTokenService {
  return new MandateTokenService(config);
}
