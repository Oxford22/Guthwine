/**
 * Guthwine - Delegation Service
 * Hierarchical delegation with JWT tokens
 */

import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { prisma } from '@guthwine/database';
import { hash } from '@guthwine/core';

const JWT_SECRET = process.env.GUTHWINE_JWT_SECRET || 'default-jwt-secret';

export interface DelegationConstraints {
  maxAmount?: number;
  allowedMerchants?: string[];
  blockedMerchants?: string[];
  allowedCategories?: string[];
  semanticConstraints?: string;
  expiresInSeconds?: number;
}

export class DelegationService {
  /**
   * Issue a delegation token
   */
  async issueDelegation(input: {
    organizationId: string;
    issuerAgentId: string;
    recipientAgentId: string;
    constraints: DelegationConstraints;
    issuedByUserId: string;
  }): Promise<{
    id: string;
    token: string;
    expiresAt: Date;
  }> {
    // Get agents
    const [issuer, recipient] = await Promise.all([
      prisma.agent.findUnique({ where: { id: input.issuerAgentId } }),
      prisma.agent.findUnique({ where: { id: input.recipientAgentId } }),
    ]);

    if (!issuer || !recipient) {
      throw new Error('Agent not found');
    }

    // Calculate expiration
    const expiresInSeconds = input.constraints.expiresInSeconds || 86400;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Create JWT payload
    const jti = uuidv4();
    const payload = {
      iss: issuer.did,
      sub: recipient.did,
      aud: 'guthwine',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
      jti,
      guthwine: {
        type: 'DELEGATION',
        version: 2,
        organizationId: input.organizationId,
        constraints: input.constraints,
      },
    };

    // Sign token
    const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
    const tokenHash = hash(token);

    // Store delegation
    const delegation = await prisma.delegationToken.create({
      data: {
        id: uuidv4(),
        organizationId: input.organizationId,
        issuerAgentId: input.issuerAgentId,
        issuerDid: issuer.did,
        recipientAgentId: input.recipientAgentId,
        recipientDid: recipient.did,
        tokenJti: jti,
        signedToken: token,
        tokenHash,
        depth: 0,
        chainHash: tokenHash,
        constraints: input.constraints as any,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    return {
      id: delegation.id,
      token,
      expiresAt,
    };
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(
    delegationId: string,
    reason: string,
    revokedByUserId: string
  ): Promise<void> {
    await prisma.delegationToken.update({
      where: { id: delegationId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: revokedByUserId,
        revokedReason: reason,
      },
    });
  }

  /**
   * Verify a delegation token
   */
  async verifyToken(token: string): Promise<{
    valid: boolean;
    payload?: any;
    error?: string;
  }> {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;

      const delegation = await prisma.delegationToken.findFirst({
        where: { tokenJti: payload.jti },
      });

      if (!delegation) {
        return { valid: false, error: 'Delegation not found' };
      }

      if (delegation.status !== 'ACTIVE') {
        return { valid: false, error: `Delegation is ${delegation.status}` };
      }

      return { valid: true, payload };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid token',
      };
    }
  }
}

export const delegationService = new DelegationService();
