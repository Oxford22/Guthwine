/**
 * Guthwine - Delegation Service
 * Manages delegation tokens for recursive agent authorization
 */

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { VaultService } from './VaultService.js';
import { IdentityService } from './IdentityService.js';
import type { 
  DelegationConstraints, 
  DelegationTokenPayload,
  IssueDelegation 
} from '../types/index.js';

export class DelegationService {
  private prisma: PrismaClient;
  private vault: VaultService;
  private identity: IdentityService;
  private jwtSecret: string;

  constructor(
    prisma: PrismaClient, 
    vault: VaultService, 
    identity: IdentityService,
    jwtSecret?: string
  ) {
    this.prisma = prisma;
    this.vault = vault;
    this.identity = identity;
    this.jwtSecret = jwtSecret || process.env.GUTHWINE_JWT_SECRET || 'default-jwt-secret-change-in-production';
  }

  /**
   * Issue a new delegation token
   */
  async issueDelegation(
    issuerDid: string,
    recipientDid: string,
    constraints: DelegationConstraints,
    parentTokenHash?: string
  ): Promise<{ token: string; tokenHash: string }> {
    // Verify issuer exists and is not frozen
    const issuer = await this.identity.getAgentByDid(issuerDid);
    if (!issuer) {
      throw new Error(`Issuer agent not found: ${issuerDid}`);
    }
    if (issuer.isFrozen) {
      throw new Error(`Issuer agent is frozen: ${issuerDid}`);
    }

    // Verify recipient exists
    const recipient = await this.identity.getAgentByDid(recipientDid);
    if (!recipient) {
      throw new Error(`Recipient agent not found: ${recipientDid}`);
    }

    // If there's a parent token, verify constraints are not escalated
    if (parentTokenHash) {
      const parentToken = await this.prisma.delegationToken.findUnique({
        where: { tokenHash: parentTokenHash },
      });

      if (!parentToken) {
        throw new Error('Parent delegation token not found');
      }

      if (parentToken.isRevoked) {
        throw new Error('Parent delegation token has been revoked');
      }

      // Verify constraints are subset of parent
      const parentConstraints = JSON.parse(parentToken.constraints);
      if (parentConstraints.maxAmount && constraints.maxAmount) {
        if (constraints.maxAmount > parentConstraints.maxAmount) {
          throw new Error('Cannot delegate higher amount than parent token allows');
        }
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + (constraints.expiresIn || 3600)) * 1000);

    const payload: DelegationTokenPayload = {
      iss: issuerDid,
      sub: recipientDid,
      iat: now,
      exp: now + (constraints.expiresIn || 3600),
      constraints,
      parentTokenHash,
    };

    // Sign the token
    const token = jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
    const tokenHash = this.vault.hash(token);

    // Store in database
    await this.prisma.delegationToken.create({
      data: {
        tokenHash,
        issuerDid,
        recipientDid,
        constraints: JSON.stringify(constraints),
        parentTokenHash,
        expiresAt,
      },
    });

    return { token, tokenHash };
  }

  /**
   * Verify a delegation token
   */
  async verifyToken(token: string): Promise<{
    valid: boolean;
    payload?: DelegationTokenPayload;
    error?: string;
  }> {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as DelegationTokenPayload;
      const tokenHash = this.vault.hash(token);

      // Check if token exists and is not revoked
      const storedToken = await this.prisma.delegationToken.findUnique({
        where: { tokenHash },
      });

      if (!storedToken) {
        return { valid: false, error: 'Token not found in registry' };
      }

      if (storedToken.isRevoked) {
        return { valid: false, error: 'Token has been revoked' };
      }

      if (new Date() > storedToken.expiresAt) {
        return { valid: false, error: 'Token has expired' };
      }

      return { valid: true, payload };
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Token verification failed' 
      };
    }
  }

  /**
   * Verify a complete delegation chain
   */
  async verifyDelegationChain(
    tokens: string[],
    requestingAgentDid: string
  ): Promise<{
    valid: boolean;
    rootIssuerDid?: string;
    effectiveConstraints?: DelegationConstraints;
    error?: string;
  }> {
    if (tokens.length === 0) {
      return { valid: false, error: 'No delegation tokens provided' };
    }

    let effectiveConstraints: DelegationConstraints = {
      expiresIn: Number.MAX_SAFE_INTEGER,
    };
    let previousRecipient: string | null = null;
    let rootIssuerDid: string | null = null;

    for (let i = 0; i < tokens.length; i++) {
      const result = await this.verifyToken(tokens[i]);
      
      if (!result.valid || !result.payload) {
        return { valid: false, error: `Token ${i} invalid: ${result.error}` };
      }

      const payload = result.payload;

      // First token establishes the root issuer
      if (i === 0) {
        rootIssuerDid = payload.iss;
      } else {
        // Subsequent tokens must chain correctly
        if (payload.iss !== previousRecipient) {
          return { 
            valid: false, 
            error: `Chain broken at token ${i}: issuer ${payload.iss} does not match previous recipient ${previousRecipient}` 
          };
        }
      }

      previousRecipient = payload.sub;

      // Merge constraints (take the most restrictive)
      effectiveConstraints = this.mergeConstraints(effectiveConstraints, payload.constraints);
    }

    // Final recipient must be the requesting agent
    if (previousRecipient !== requestingAgentDid) {
      return { 
        valid: false, 
        error: `Final delegation recipient ${previousRecipient} does not match requesting agent ${requestingAgentDid}` 
      };
    }

    return {
      valid: true,
      rootIssuerDid: rootIssuerDid!,
      effectiveConstraints,
    };
  }

  /**
   * Merge two constraint sets, taking the most restrictive values
   */
  private mergeConstraints(
    parent: DelegationConstraints,
    child: DelegationConstraints
  ): DelegationConstraints {
    const merged: DelegationConstraints = {
      expiresIn: Math.min(
        parent.expiresIn || Number.MAX_SAFE_INTEGER,
        child.expiresIn || Number.MAX_SAFE_INTEGER
      ),
    };

    // Take lower max amount
    if (parent.maxAmount !== undefined || child.maxAmount !== undefined) {
      merged.maxAmount = Math.min(
        parent.maxAmount ?? Number.MAX_SAFE_INTEGER,
        child.maxAmount ?? Number.MAX_SAFE_INTEGER
      );
    }

    // Take intersection of allowed merchants
    if (parent.allowedMerchants || child.allowedMerchants) {
      const parentMerchants = new Set(parent.allowedMerchants || []);
      const childMerchants = child.allowedMerchants || [];
      
      if (parentMerchants.size > 0 && childMerchants.length > 0) {
        merged.allowedMerchants = childMerchants.filter(m => parentMerchants.has(m));
      } else {
        merged.allowedMerchants = childMerchants.length > 0 
          ? childMerchants 
          : Array.from(parentMerchants);
      }
    }

    // Take intersection of allowed categories
    if (parent.allowedCategories || child.allowedCategories) {
      const parentCategories = new Set(parent.allowedCategories || []);
      const childCategories = child.allowedCategories || [];
      
      if (parentCategories.size > 0 && childCategories.length > 0) {
        merged.allowedCategories = childCategories.filter(c => parentCategories.has(c));
      } else {
        merged.allowedCategories = childCategories.length > 0 
          ? childCategories 
          : Array.from(parentCategories);
      }
    }

    // Combine semantic constraints
    if (parent.semanticConstraints || child.semanticConstraints) {
      const constraints = [
        parent.semanticConstraints,
        child.semanticConstraints,
      ].filter(Boolean);
      merged.semanticConstraints = constraints.join(' AND ');
    }

    // Currency must match if both specified
    if (parent.currency && child.currency && parent.currency !== child.currency) {
      throw new Error('Currency mismatch in delegation chain');
    }
    merged.currency = child.currency || parent.currency;

    return merged;
  }

  /**
   * Revoke a delegation token
   */
  async revokeToken(tokenHash: string, reason: string): Promise<boolean> {
    try {
      await this.prisma.delegationToken.update({
        where: { tokenHash },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
          revokedReason: reason,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Revoke all tokens issued by an agent
   */
  async revokeAllTokensByIssuer(issuerDid: string, reason: string): Promise<number> {
    const result = await this.prisma.delegationToken.updateMany({
      where: { 
        issuerDid,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
    return result.count;
  }

  /**
   * Get all active delegations for an agent
   */
  async getActiveDelegations(agentDid: string): Promise<{
    issued: any[];
    received: any[];
  }> {
    const now = new Date();

    const issued = await this.prisma.delegationToken.findMany({
      where: {
        issuerDid: agentDid,
        isRevoked: false,
        expiresAt: { gt: now },
      },
    });

    const received = await this.prisma.delegationToken.findMany({
      where: {
        recipientDid: agentDid,
        isRevoked: false,
        expiresAt: { gt: now },
      },
    });

    return { issued, received };
  }

  /**
   * Check if a transaction is allowed by delegation constraints
   */
  checkConstraints(
    constraints: DelegationConstraints,
    amount: number,
    currency: string,
    merchantId?: string,
    merchantCategory?: string
  ): { allowed: boolean; violations: string[] } {
    const violations: string[] = [];

    // Check amount
    if (constraints.maxAmount !== undefined && amount > constraints.maxAmount) {
      violations.push(`Amount ${amount} exceeds maximum allowed ${constraints.maxAmount}`);
    }

    // Check currency
    if (constraints.currency && constraints.currency !== currency) {
      violations.push(`Currency ${currency} not allowed, expected ${constraints.currency}`);
    }

    // Check merchant
    if (constraints.allowedMerchants && constraints.allowedMerchants.length > 0 && merchantId) {
      if (!constraints.allowedMerchants.includes(merchantId)) {
        violations.push(`Merchant ${merchantId} not in allowed list`);
      }
    }

    // Check category
    if (constraints.allowedCategories && constraints.allowedCategories.length > 0 && merchantCategory) {
      if (!constraints.allowedCategories.includes(merchantCategory)) {
        violations.push(`Category ${merchantCategory} not in allowed list`);
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }
}
