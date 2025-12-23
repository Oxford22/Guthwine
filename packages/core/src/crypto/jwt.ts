/**
 * Guthwine - JWT Service
 * Issue and verify JWTs for mandates and delegations
 */

import * as jose from 'jose';
import type { 
  MandatePayload, 
  DelegationTokenPayload,
  DelegationConstraints 
} from '../types/index.js';

// JWT configuration
export interface JWTConfig {
  issuer: string;
  audience: string;
  secretKey: string;
  defaultExpirationSeconds: number;
}

// Default configuration
const DEFAULT_CONFIG: JWTConfig = {
  issuer: 'guthwine',
  audience: 'guthwine',
  secretKey: process.env.JWT_SECRET || 'default-secret-change-in-production',
  defaultExpirationSeconds: 300, // 5 minutes
};

let config: JWTConfig = { ...DEFAULT_CONFIG };

/**
 * Configure JWT settings
 */
export function configureJWT(newConfig: Partial<JWTConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get the secret key as a Uint8Array
 */
function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(config.secretKey);
}

/**
 * Issue a transaction mandate token
 */
export async function issueMandateToken(
  payload: Omit<MandatePayload, 'iss' | 'aud' | 'iat' | 'exp'> & { exp?: number }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp || now + config.defaultExpirationSeconds;

  const fullPayload: MandatePayload = {
    ...payload,
    iss: config.issuer,
    aud: payload.guthwine.merchantId || config.audience,
    iat: now,
    exp,
  };

  const jwt = await new jose.SignJWT(fullPayload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecretKey());

  return jwt;
}

/**
 * Verify a mandate token
 */
export async function verifyMandateToken(token: string): Promise<{
  valid: boolean;
  payload?: MandatePayload;
  error?: string;
}> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecretKey(), {
      issuer: config.issuer,
    });

    // Validate it's a mandate token
    const guthwinePayload = payload as unknown as MandatePayload;
    if (guthwinePayload.guthwine?.type !== 'TRANSACTION_MANDATE') {
      return { valid: false, error: 'Not a mandate token' };
    }

    return { valid: true, payload: guthwinePayload };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return { valid: false, error: 'Token expired' };
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      return { valid: false, error: `Claim validation failed: ${error.message}` };
    }
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Token verification failed' 
    };
  }
}

/**
 * Decode a mandate token without verification
 */
export function decodeMandateToken(token: string): MandatePayload | null {
  try {
    const decoded = jose.decodeJwt(token);
    return decoded as unknown as MandatePayload;
  } catch {
    return null;
  }
}

/**
 * Issue a delegation token
 */
export async function issueDelegationToken(
  issuerDid: string,
  recipientDid: string,
  organizationId: string,
  constraints: DelegationConstraints,
  options: {
    parentTokenId?: string;
    depth?: number;
    chainHash?: string;
    expiresInSeconds?: number;
    jti?: string;
  } = {}
): Promise<{ token: string; jti: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (options.expiresInSeconds || 86400); // 24 hours default
  const jti = options.jti || crypto.randomUUID();

  const payload: DelegationTokenPayload = {
    iss: issuerDid,
    sub: recipientDid,
    aud: config.audience,
    iat: now,
    exp,
    jti,
    guthwine: {
      type: 'DELEGATION',
      version: 1,
      organizationId,
      parentTokenId: options.parentTokenId || null,
      constraints,
      depth: options.depth || 0,
      chainHash: options.chainHash || '',
    },
  };

  const jwt = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecretKey());

  return { token: jwt, jti };
}

/**
 * Verify a delegation token
 */
export async function verifyDelegationToken(token: string): Promise<{
  valid: boolean;
  payload?: DelegationTokenPayload;
  error?: string;
}> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecretKey(), {
      audience: config.audience,
    });

    // Validate it's a delegation token
    const guthwinePayload = payload as unknown as DelegationTokenPayload;
    if (guthwinePayload.guthwine?.type !== 'DELEGATION') {
      return { valid: false, error: 'Not a delegation token' };
    }

    return { valid: true, payload: guthwinePayload };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return { valid: false, error: 'Token expired' };
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      return { valid: false, error: `Claim validation failed: ${error.message}` };
    }
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Token verification failed' 
    };
  }
}

/**
 * Decode a delegation token without verification
 */
export function decodeDelegationToken(token: string): DelegationTokenPayload | null {
  try {
    const decoded = jose.decodeJwt(token);
    return decoded as unknown as DelegationTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Verify a delegation chain
 */
export async function verifyDelegationChain(
  tokens: string[],
  expectedRecipientDid: string
): Promise<{
  valid: boolean;
  chainDepth: number;
  rootIssuerDid?: string;
  effectiveConstraints?: DelegationConstraints;
  errors: string[];
}> {
  if (tokens.length === 0) {
    return { valid: false, chainDepth: 0, errors: ['No delegation tokens provided'] };
  }

  const errors: string[] = [];
  let previousRecipient: string | null = null;
  let rootIssuerDid: string | null = null;
  let effectiveConstraints: DelegationConstraints | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const result = await verifyDelegationToken(tokens[i]!);
    
    if (!result.valid || !result.payload) {
      errors.push(`Token ${i}: ${result.error || 'Invalid token'}`);
      continue;
    }

    const payload = result.payload;

    // First token establishes root issuer
    if (i === 0) {
      rootIssuerDid = payload.iss;
      effectiveConstraints = { ...payload.guthwine.constraints };
    } else {
      // Verify chain linkage
      if (payload.iss !== previousRecipient) {
        errors.push(
          `Token ${i}: Issuer ${payload.iss} does not match previous recipient ${previousRecipient}`
        );
      }

      // Merge constraints (most restrictive)
      if (effectiveConstraints) {
        effectiveConstraints = mergeConstraints(effectiveConstraints, payload.guthwine.constraints);
      }
    }

    previousRecipient = payload.sub;
  }

  // Verify final recipient matches expected
  if (previousRecipient !== expectedRecipientDid) {
    errors.push(
      `Final recipient ${previousRecipient} does not match expected ${expectedRecipientDid}`
    );
  }

  return {
    valid: errors.length === 0,
    chainDepth: tokens.length,
    rootIssuerDid: rootIssuerDid || undefined,
    effectiveConstraints: effectiveConstraints || undefined,
    errors,
  };
}

/**
 * Merge two constraint sets, taking the most restrictive values
 */
function mergeConstraints(
  parent: DelegationConstraints,
  child: DelegationConstraints
): DelegationConstraints {
  return {
    // Take lower amounts
    maxAmount: minNullable(parent.maxAmount, child.maxAmount),
    maxDailySpend: minNullable(parent.maxDailySpend, child.maxDailySpend),
    maxWeeklySpend: minNullable(parent.maxWeeklySpend, child.maxWeeklySpend),
    maxTotalSpend: minNullable(parent.maxTotalSpend, child.maxTotalSpend),

    // Intersect allowed lists
    allowedCurrencies: intersectArrays(parent.allowedCurrencies, child.allowedCurrencies),
    allowedMerchants: intersectArrays(parent.allowedMerchants, child.allowedMerchants),
    allowedCategories: intersectArrays(parent.allowedCategories, child.allowedCategories),

    // Union blocked lists
    blockedMerchants: unionArrays(parent.blockedMerchants, child.blockedMerchants),
    blockedCategories: unionArrays(parent.blockedCategories, child.blockedCategories),

    // Take earlier end time
    validFrom: maxDate(parent.validFrom, child.validFrom),
    validUntil: minDate(parent.validUntil, child.validUntil),

    // Intersect allowed times
    allowedDaysOfWeek: intersectArrays(parent.allowedDaysOfWeek, child.allowedDaysOfWeek),
    allowedHoursStart: maxNullable(parent.allowedHoursStart, child.allowedHoursStart),
    allowedHoursEnd: minNullable(parent.allowedHoursEnd, child.allowedHoursEnd),
    timezone: child.timezone || parent.timezone,

    // Take more restrictive delegation settings
    canSubDelegate: parent.canSubDelegate && child.canSubDelegate,
    maxSubDelegationDepth: minNullable(
      parent.maxSubDelegationDepth,
      child.maxSubDelegationDepth
    ) ?? 0,

    // Combine semantic constraints
    semanticConstraints: combineSemanticConstraints(
      parent.semanticConstraints,
      child.semanticConstraints
    ),

    // Merge custom constraints
    custom: { ...parent.custom, ...child.custom },
  };
}

// Helper functions for constraint merging
function minNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

function maxNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}

function minDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return a < b ? a : b;
}

function maxDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return a > b ? a : b;
}

function intersectArrays<T>(a: T[] | null | undefined, b: T[] | null | undefined): T[] | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  const setB = new Set(b);
  return a.filter(x => setB.has(x));
}

function unionArrays<T>(a: T[] | null | undefined, b: T[] | null | undefined): T[] | null {
  if (a == null && b == null) return null;
  return [...new Set([...(a || []), ...(b || [])])];
}

function combineSemanticConstraints(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a;
  return `${a} AND ${b}`;
}
