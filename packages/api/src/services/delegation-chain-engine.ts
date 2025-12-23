/**
 * Delegation Chain Engine
 * 
 * Features:
 * - Full chain verification with cryptographic proofs
 * - Redis-backed chain caching
 * - D3.js visualization data export
 * - Chain revocation propagation
 */

import { prisma, Prisma, DelegationToken } from '@guthwine/database';
import { getRedis } from '@guthwine/database';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

// =============================================================================
// TYPES
// =============================================================================

export interface DelegationNode {
  id: string;
  issuerAgentId: string;
  recipientAgentId: string;
  constraints: DelegationConstraints;
  issuedAt: Date;
  expiresAt: Date;
  status: 'active' | 'revoked' | 'expired';
  tokenHash: string;
  parentId?: string;
  depth: number;
}

export interface DelegationConstraints {
  maxAmount?: number;
  currency?: string;
  allowedMerchants?: string[];
  blockedMerchants?: string[];
  allowedCategories?: string[];
  blockedCategories?: string[];
  maxUsageCount?: number;
  permissions?: string[];
  timeWindow?: {
    start: number;
    end: number;
  };
  requireReason?: boolean;
  maxDelegationDepth?: number;
}

export interface ChainVerificationResult {
  valid: boolean;
  chain: DelegationNode[];
  effectivePermissions: string[];
  effectiveConstraints: DelegationConstraints;
  errors: string[];
  warnings: string[];
  verificationProof: string;
}

export interface D3TreeNode {
  id: string;
  name: string;
  type: 'agent' | 'delegation';
  status: 'active' | 'revoked' | 'expired';
  permissions: string[];
  depth: number;
  children: D3TreeNode[];
  metadata: {
    issuerName?: string;
    recipientName?: string;
    issuedAt?: string;
    expiresAt?: string;
    constraintSummary?: string;
  };
}

export interface D3ForceNode {
  id: string;
  label: string;
  type: 'agent' | 'delegation';
  status: 'active' | 'revoked' | 'expired';
  group: number;
}

export interface D3ForceLink {
  source: string;
  target: string;
  type: 'delegates' | 'receives';
  permissions: string[];
  status: 'active' | 'revoked' | 'expired';
}

export interface D3ForceGraph {
  nodes: D3ForceNode[];
  links: D3ForceLink[];
}

// =============================================================================
// DELEGATION CHAIN CACHE
// =============================================================================

export class DelegationChainCache {
  private redis: ReturnType<typeof getRedis> | null = null;
  private localCache: Map<string, { data: DelegationNode[]; expires: number }> = new Map();
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_PREFIX = 'guthwine:delegation:chain:';

  async initialize(): Promise<void> {
    try {
      this.redis = getRedis();
    } catch {
      console.warn('Redis not available, using local cache only');
    }
  }

  async getChain(delegationId: string): Promise<DelegationNode[] | null> {
    const key = `${this.CACHE_PREFIX}${delegationId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(key);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {
        // Fall through to local cache
      }
    }

    const local = this.localCache.get(key);
    if (local && local.expires > Date.now()) {
      return local.data;
    }

    return null;
  }

  async setChain(delegationId: string, chain: DelegationNode[]): Promise<void> {
    const key = `${this.CACHE_PREFIX}${delegationId}`;

    if (this.redis) {
      try {
        await this.redis.setex(key, this.CACHE_TTL, JSON.stringify(chain));
      } catch {
        // Fall through to local cache
      }
    }

    this.localCache.set(key, {
      data: chain,
      expires: Date.now() + this.CACHE_TTL * 1000,
    });
  }

  async invalidateChain(delegationId: string): Promise<void> {
    const key = `${this.CACHE_PREFIX}${delegationId}`;

    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        // Continue
      }
    }

    this.localCache.delete(key);
  }

  async invalidateAgentChains(agentId: string): Promise<void> {
    // Clear all caches (simplified)
    this.localCache.clear();
  }

  async clearAll(): Promise<void> {
    this.localCache.clear();
  }
}

// =============================================================================
// DELEGATION CHAIN ENGINE
// =============================================================================

export class DelegationChainEngine {
  private prisma = prisma;
  private cache: DelegationChainCache;
  private signingKey: string;

  constructor(signingKey: string) {
    this.signingKey = signingKey;
    this.cache = new DelegationChainCache();
  }

  async initialize(): Promise<void> {
    await this.cache.initialize();
  }

  // =============================================================================
  // CHAIN VERIFICATION
  // =============================================================================

  async verifyChain(delegationId: string): Promise<ChainVerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Try cache first
    const cachedChain = await this.cache.getChain(delegationId);
    if (cachedChain) {
      const quickVerify = this.quickVerifyChain(cachedChain);
      if (quickVerify.valid) {
        return {
          valid: true,
          chain: cachedChain,
          effectivePermissions: this.computeEffectivePermissions(cachedChain),
          effectiveConstraints: this.computeEffectiveConstraints(cachedChain),
          errors: [],
          warnings: quickVerify.warnings,
          verificationProof: this.generateVerificationProof(cachedChain),
        };
      }
      await this.cache.invalidateChain(delegationId);
    }

    // Build chain from database
    const chain = await this.buildChain(delegationId);
    if (chain.length === 0) {
      return {
        valid: false,
        chain: [],
        effectivePermissions: [],
        effectiveConstraints: {},
        errors: ['Delegation not found'],
        warnings: [],
        verificationProof: '',
      };
    }

    // Verify each node in the chain
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      if (!node) continue;
      
      const parent = i > 0 ? chain[i - 1] : null;

      // Verify status
      if (node.status === 'revoked') {
        errors.push(`Delegation ${node.id} has been revoked`);
      }

      // Verify expiration
      if (new Date() > node.expiresAt) {
        errors.push(`Delegation ${node.id} has expired`);
      }

      // Verify parent relationship
      if (parent) {
        // Child expiration must not exceed parent
        if (node.expiresAt > parent.expiresAt) {
          warnings.push(
            `Delegation ${node.id} expires after parent (will be limited by parent expiration)`
          );
        }

        // Check delegation depth limit
        const parentConstraints = parent.constraints;
        if (parentConstraints.maxDelegationDepth !== undefined) {
          if (node.depth > parentConstraints.maxDelegationDepth) {
            errors.push(
              `Delegation ${node.id} exceeds max delegation depth of ${parentConstraints.maxDelegationDepth}`
            );
          }
        }
      }

      // Verify issuer is active
      const issuer = await this.prisma.agent.findUnique({
        where: { id: node.issuerAgentId },
      });
      if (!issuer || issuer.status !== 'ACTIVE') {
        errors.push(`Issuer agent ${node.issuerAgentId} is not active`);
      }

      // Verify recipient is active
      const recipient = await this.prisma.agent.findUnique({
        where: { id: node.recipientAgentId },
      });
      if (!recipient || recipient.status !== 'ACTIVE') {
        warnings.push(`Recipient agent ${node.recipientAgentId} is not active`);
      }
    }

    const valid = errors.length === 0;

    if (valid) {
      await this.cache.setChain(delegationId, chain);
    }

    return {
      valid,
      chain,
      effectivePermissions: this.computeEffectivePermissions(chain),
      effectiveConstraints: this.computeEffectiveConstraints(chain),
      errors,
      warnings,
      verificationProof: valid ? this.generateVerificationProof(chain) : '',
    };
  }

  private async buildChain(delegationId: string): Promise<DelegationNode[]> {
    const chain: DelegationNode[] = [];
    let currentId: string | null = delegationId;

    while (currentId) {
      const delegation: DelegationToken | null = await this.prisma.delegationToken.findUnique({
        where: { id: currentId },
      });

      if (!delegation) break;

      chain.unshift({
        id: delegation.id,
        issuerAgentId: delegation.issuerAgentId,
        recipientAgentId: delegation.recipientAgentId,
        constraints: delegation.constraints as DelegationConstraints,
        issuedAt: delegation.createdAt,
        expiresAt: delegation.expiresAt,
        status: delegation.status.toLowerCase() as 'active' | 'revoked' | 'expired',
        tokenHash: delegation.tokenHash,
        parentId: delegation.parentTokenId ?? undefined,
        depth: delegation.depth,
      });

      currentId = delegation.parentTokenId;
    }

    return chain;
  }

  private quickVerifyChain(chain: DelegationNode[]): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const now = new Date();

    for (const node of chain) {
      if (node.status === 'revoked') {
        return { valid: false, warnings: [] };
      }
      if (now > node.expiresAt) {
        return { valid: false, warnings: [] };
      }
    }

    return { valid: true, warnings };
  }

  private computeEffectivePermissions(chain: DelegationNode[]): string[] {
    if (chain.length === 0) return [];
    
    const firstNode = chain[0];
    if (!firstNode) return [];
    
    let permissions = new Set(firstNode.constraints.permissions ?? []);
    
    for (let i = 1; i < chain.length; i++) {
      const node = chain[i];
      if (!node) continue;
      const nodePerms = new Set(node.constraints.permissions ?? []);
      permissions = new Set([...permissions].filter(p => nodePerms.has(p)));
    }

    return Array.from(permissions);
  }

  private computeEffectiveConstraints(chain: DelegationNode[]): DelegationConstraints {
    const effective: DelegationConstraints = {};

    for (const node of chain) {
      const c = node.constraints;

      if (c.maxAmount !== undefined) {
        effective.maxAmount = Math.min(effective.maxAmount ?? Infinity, c.maxAmount);
      }

      if (c.currency) {
        effective.currency = c.currency;
      }

      if (c.allowedMerchants) {
        if (effective.allowedMerchants) {
          effective.allowedMerchants = effective.allowedMerchants.filter(
            m => c.allowedMerchants!.includes(m)
          );
        } else {
          effective.allowedMerchants = [...c.allowedMerchants];
        }
      }

      if (c.blockedMerchants) {
        effective.blockedMerchants = [
          ...new Set([...(effective.blockedMerchants ?? []), ...c.blockedMerchants]),
        ];
      }

      if (c.maxUsageCount !== undefined) {
        effective.maxUsageCount = Math.min(
          effective.maxUsageCount ?? Infinity,
          c.maxUsageCount
        );
      }

      if (c.timeWindow) {
        if (effective.timeWindow) {
          effective.timeWindow = {
            start: Math.max(effective.timeWindow.start, c.timeWindow.start),
            end: Math.min(effective.timeWindow.end, c.timeWindow.end),
          };
        } else {
          effective.timeWindow = { ...c.timeWindow };
        }
      }

      if (c.requireReason) {
        effective.requireReason = true;
      }

      if (c.maxDelegationDepth !== undefined) {
        effective.maxDelegationDepth = Math.min(
          effective.maxDelegationDepth ?? Infinity,
          c.maxDelegationDepth
        );
      }
    }

    if (effective.maxAmount === Infinity) delete effective.maxAmount;
    if (effective.maxUsageCount === Infinity) delete effective.maxUsageCount;
    if (effective.maxDelegationDepth === Infinity) delete effective.maxDelegationDepth;

    return effective;
  }

  private generateVerificationProof(chain: DelegationNode[]): string {
    const firstNode = chain[0];
    const lastNode = chain[chain.length - 1];
    
    const proofData = {
      chainLength: chain.length,
      rootDelegation: firstNode?.id,
      leafDelegation: lastNode?.id,
      effectivePermissions: this.computeEffectivePermissions(chain),
      verifiedAt: new Date().toISOString(),
      chainHash: this.computeChainHash(chain),
    };

    return jwt.sign(proofData, this.signingKey, { expiresIn: '1h' });
  }

  private computeChainHash(chain: DelegationNode[]): string {
    const data = chain.map(n => n.tokenHash).join(':');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // =============================================================================
  // CHAIN REVOCATION
  // =============================================================================

  async revokeChain(
    delegationId: string,
    reason: string,
    revokedById: string
  ): Promise<{ revokedCount: number; affectedAgents: string[] }> {
    const affectedAgents = new Set<string>();
    let revokedCount = 0;

    const toRevoke = await this.getSubtree(delegationId);

    for (const delegation of toRevoke) {
      if (delegation.status === 'ACTIVE') {
        await this.prisma.delegationToken.update({
          where: { id: delegation.id },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedById,
            revokedReason: reason,
          },
        });

        affectedAgents.add(delegation.recipientAgentId);
        revokedCount++;

        await this.cache.invalidateChain(delegation.id);
      }
    }

    for (const agentId of affectedAgents) {
      await this.cache.invalidateAgentChains(agentId);
    }

    return {
      revokedCount,
      affectedAgents: Array.from(affectedAgents),
    };
  }

  private async getSubtree(delegationId: string): Promise<DelegationToken[]> {
    const result: DelegationToken[] = [];
    const queue = [delegationId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      const delegation: DelegationToken | null = await this.prisma.delegationToken.findUnique({
        where: { id: currentId },
      });

      if (delegation) {
        result.push(delegation);

        const children = await this.prisma.delegationToken.findMany({
          where: { parentTokenId: currentId },
        });

        for (const child of children) {
          queue.push(child.id);
        }
      }
    }

    return result;
  }

  // =============================================================================
  // D3.JS VISUALIZATION
  // =============================================================================

  async exportTreeVisualization(rootAgentId: string): Promise<D3TreeNode> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: rootAgentId },
    });

    if (!agent) {
      throw new Error(`Agent ${rootAgentId} not found`);
    }

    const rootNode: D3TreeNode = {
      id: agent.id,
      name: agent.name,
      type: 'agent',
      status: 'active',
      permissions: [],
      depth: 0,
      children: [],
      metadata: {},
    };

    const delegations = await this.prisma.delegationToken.findMany({
      where: { issuerAgentId: rootAgentId },
    });

    for (const delegation of delegations) {
      const delegationNode = await this.buildTreeNode(delegation, 1);
      rootNode.children.push(delegationNode);
    }

    return rootNode;
  }

  private async buildTreeNode(delegation: DelegationToken, depth: number): Promise<D3TreeNode> {
    const recipient = await this.prisma.agent.findUnique({
      where: { id: delegation.recipientAgentId },
    });

    const constraints = delegation.constraints as DelegationConstraints;

    const node: D3TreeNode = {
      id: delegation.id,
      name: recipient?.name ?? delegation.recipientAgentId,
      type: 'delegation',
      status: delegation.status.toLowerCase() as 'active' | 'revoked' | 'expired',
      permissions: constraints.permissions ?? [],
      depth,
      children: [],
      metadata: {
        issuerName: delegation.issuerAgentId,
        recipientName: recipient?.name,
        issuedAt: delegation.createdAt.toISOString(),
        expiresAt: delegation.expiresAt.toISOString(),
        constraintSummary: this.summarizeConstraints(constraints),
      },
    };

    const childDelegations = await this.prisma.delegationToken.findMany({
      where: { parentTokenId: delegation.id },
    });

    for (const child of childDelegations) {
      const childNode = await this.buildTreeNode(child, depth + 1);
      node.children.push(childNode);
    }

    return node;
  }

  async exportForceGraph(organizationId: string): Promise<D3ForceGraph> {
    const nodes: D3ForceNode[] = [];
    const links: D3ForceLink[] = [];
    const agentGroups = new Map<string, number>();
    let groupCounter = 0;

    const agents = await this.prisma.agent.findMany({
      where: { organizationId },
    });

    for (const agent of agents) {
      if (!agentGroups.has(agent.id)) {
        agentGroups.set(agent.id, groupCounter++);
      }

      nodes.push({
        id: agent.id,
        label: agent.name,
        type: 'agent',
        status: agent.status === 'ACTIVE' ? 'active' : 'revoked',
        group: agentGroups.get(agent.id)!,
      });
    }

    const delegations = await this.prisma.delegationToken.findMany({
      where: { organizationId },
    });

    for (const delegation of delegations) {
      const constraints = delegation.constraints as DelegationConstraints;
      
      nodes.push({
        id: delegation.id,
        label: `Delegation ${delegation.id.slice(0, 8)}`,
        type: 'delegation',
        status: delegation.status.toLowerCase() as 'active' | 'revoked' | 'expired',
        group: agentGroups.get(delegation.issuerAgentId) ?? 0,
      });

      links.push({
        source: delegation.issuerAgentId,
        target: delegation.id,
        type: 'delegates',
        permissions: constraints.permissions ?? [],
        status: delegation.status.toLowerCase() as 'active' | 'revoked' | 'expired',
      });

      links.push({
        source: delegation.id,
        target: delegation.recipientAgentId,
        type: 'receives',
        permissions: constraints.permissions ?? [],
        status: delegation.status.toLowerCase() as 'active' | 'revoked' | 'expired',
      });
    }

    return { nodes, links };
  }

  private summarizeConstraints(constraints: DelegationConstraints): string {
    const parts: string[] = [];

    if (constraints.maxAmount) {
      parts.push(`Max: ${constraints.currency ?? '$'}${constraints.maxAmount}`);
    }
    if (constraints.maxUsageCount) {
      parts.push(`Uses: ${constraints.maxUsageCount}`);
    }
    if (constraints.allowedCategories?.length) {
      parts.push(`Categories: ${constraints.allowedCategories.length}`);
    }
    if (constraints.timeWindow) {
      parts.push('Time restricted');
    }
    if (constraints.requireReason) {
      parts.push('Reason required');
    }

    return parts.join(', ') || 'No constraints';
  }

  // =============================================================================
  // DELEGATION CREATION
  // =============================================================================

  async createDelegation(params: {
    organizationId: string;
    issuerAgentId: string;
    issuerDid: string;
    recipientAgentId: string;
    recipientDid: string;
    constraints: DelegationConstraints;
    expiresAt: Date;
    parentTokenId?: string;
  }): Promise<DelegationNode> {
    let parentDepth = 0;
    if (params.parentTokenId) {
      const verification = await this.verifyChain(params.parentTokenId);
      if (!verification.valid) {
        throw new Error(`Parent delegation chain is invalid: ${verification.errors.join(', ')}`);
      }
      parentDepth = verification.chain.length;
    }

    const tokenJti = crypto.randomUUID();
    const tokenPayload = {
      jti: tokenJti,
      iss: params.issuerDid,
      sub: params.recipientDid,
      constraints: params.constraints,
      parent: params.parentTokenId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(params.expiresAt.getTime() / 1000),
    };

    const signedToken = jwt.sign(tokenPayload, this.signingKey);
    const tokenHash = crypto.createHash('sha256').update(signedToken).digest('hex');
    const chainHash = params.parentTokenId 
      ? crypto.createHash('sha256').update(`${params.parentTokenId}:${tokenHash}`).digest('hex')
      : tokenHash;

    const delegation = await this.prisma.delegationToken.create({
      data: {
        organizationId: params.organizationId,
        issuerAgentId: params.issuerAgentId,
        issuerDid: params.issuerDid,
        recipientAgentId: params.recipientAgentId,
        recipientDid: params.recipientDid,
        tokenJti,
        signedToken,
        tokenHash,
        parentTokenId: params.parentTokenId,
        depth: parentDepth + 1,
        chainHash,
        constraints: params.constraints as Prisma.InputJsonValue,
        expiresAt: params.expiresAt,
        status: 'ACTIVE',
      },
    });

    return {
      id: delegation.id,
      issuerAgentId: delegation.issuerAgentId,
      recipientAgentId: delegation.recipientAgentId,
      constraints: delegation.constraints as DelegationConstraints,
      issuedAt: delegation.createdAt,
      expiresAt: delegation.expiresAt,
      status: 'active',
      tokenHash: delegation.tokenHash,
      parentId: delegation.parentTokenId ?? undefined,
      depth: delegation.depth,
    };
  }
}

/**
 * Create a Delegation Chain Engine instance
 */
export function createDelegationChainEngine(signingKey: string): DelegationChainEngine {
  return new DelegationChainEngine(signingKey);
}
