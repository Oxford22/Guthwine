/**
 * Guthwine - Identity Service
 * Manages agent identities using Decentralized Identifiers (DIDs)
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { VaultService } from './VaultService.js';
import type { AgentIdentity, AgentRegistration } from '../types/index.js';

export class IdentityService {
  private prisma: PrismaClient;
  private vault: VaultService;

  constructor(prisma: PrismaClient, vault: VaultService) {
    this.prisma = prisma;
    this.vault = vault;
  }

  /**
   * Generate a Guthwine DID from a unique identifier
   */
  private generateDid(uniqueId: string): string {
    return `did:guthwine:${uniqueId}`;
  }

  /**
   * Register a new agent and generate its identity
   */
  async registerAgent(registration: AgentRegistration): Promise<AgentIdentity> {
    const uniqueId = crypto.randomUUID().replace(/-/g, '');
    const did = this.generateDid(uniqueId);
    
    // Generate key pair
    const { publicKey, privateKey } = this.vault.generateKeyPair();

    // Store agent in database
    const agent = await this.prisma.agent.create({
      data: {
        did,
        name: registration.name,
        description: registration.description,
        publicKey,
        ownerDid: registration.ownerDid,
        isFrozen: false,
      },
    });

    // Store private key securely
    await this.vault.storeAgentPrivateKey(did, privateKey);

    // Initialize reputation score
    await this.prisma.agentReputation.create({
      data: {
        agentDid: agent.did,
      },
    });

    return {
      id: agent.id,
      did: agent.did,
      name: agent.name,
      description: agent.description ?? undefined,
      publicKey: agent.publicKey,
      ownerDid: agent.ownerDid ?? undefined,
      isFrozen: agent.isFrozen,
      createdAt: agent.createdAt,
    };
  }

  /**
   * Get agent by DID
   */
  async getAgentByDid(did: string): Promise<AgentIdentity | null> {
    const agent = await this.prisma.agent.findUnique({
      where: { did },
    });

    if (!agent) {
      return null;
    }

    return {
      id: agent.id,
      did: agent.did,
      name: agent.name,
      description: agent.description ?? undefined,
      publicKey: agent.publicKey,
      ownerDid: agent.ownerDid ?? undefined,
      isFrozen: agent.isFrozen,
      createdAt: agent.createdAt,
    };
  }

  /**
   * Get agent by ID
   */
  async getAgentById(id: string): Promise<AgentIdentity | null> {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
    });

    if (!agent) {
      return null;
    }

    return {
      id: agent.id,
      did: agent.did,
      name: agent.name,
      description: agent.description ?? undefined,
      publicKey: agent.publicKey,
      ownerDid: agent.ownerDid ?? undefined,
      isFrozen: agent.isFrozen,
      createdAt: agent.createdAt,
    };
  }

  /**
   * Freeze an agent (Kill Switch)
   */
  async freezeAgent(did: string, reason: string): Promise<boolean> {
    try {
      await this.prisma.agent.update({
        where: { did },
        data: { 
          isFrozen: true,
          frozenAt: new Date(),
          frozenReason: reason,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unfreeze an agent
   */
  async unfreezeAgent(did: string): Promise<boolean> {
    try {
      await this.prisma.agent.update({
        where: { did },
        data: { 
          isFrozen: false,
          frozenAt: null,
          frozenReason: null,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if an agent is frozen
   */
  async isAgentFrozen(did: string): Promise<boolean> {
    const agent = await this.prisma.agent.findUnique({
      where: { did },
      select: { isFrozen: true },
    });
    return agent?.isFrozen ?? true; // Default to frozen if not found
  }

  /**
   * Check if global freeze is active
   */
  async isGlobalFreezeActive(): Promise<boolean> {
    const config = await this.prisma.globalSettings.findUnique({
      where: { key: 'global_freeze' },
    });
    return config?.value === 'true';
  }

  /**
   * Set global freeze state
   */
  async setGlobalFreeze(frozen: boolean): Promise<void> {
    await this.prisma.globalSettings.upsert({
      where: { key: 'global_freeze' },
      update: { value: frozen.toString() },
      create: { key: 'global_freeze', value: frozen.toString() },
    });
  }

  /**
   * List all agents
   */
  async listAgents(options?: { ownerDid?: string; includesFrozen?: boolean }): Promise<AgentIdentity[]> {
    const where: any = {};
    
    if (options?.ownerDid) {
      where.ownerDid = options.ownerDid;
    }
    
    if (!options?.includesFrozen) {
      where.isFrozen = false;
    }

    const agents = await this.prisma.agent.findMany({ where });

    return agents.map((agent) => ({
      id: agent.id,
      did: agent.did,
      name: agent.name,
      description: agent.description ?? undefined,
      publicKey: agent.publicKey,
      ownerDid: agent.ownerDid ?? undefined,
      isFrozen: agent.isFrozen,
      createdAt: agent.createdAt,
    }));
  }

  /**
   * Verify agent ownership chain
   */
  async verifyOwnershipChain(agentDid: string, rootOwnerDid: string): Promise<boolean> {
    let currentDid = agentDid;
    const visited = new Set<string>();

    while (currentDid && !visited.has(currentDid)) {
      if (currentDid === rootOwnerDid) {
        return true;
      }

      visited.add(currentDid);
      const agent = await this.getAgentByDid(currentDid);
      
      if (!agent || !agent.ownerDid) {
        return false;
      }

      currentDid = agent.ownerDid;
    }

    return false;
  }

  /**
   * Get agent's reputation score
   */
  async getReputationScore(did: string): Promise<{
    reputationScore: number;
    successfulTxns: number;
    failedTxns: number;
    totalVolume: number;
  } | null> {
    const reputation = await this.prisma.agentReputation.findUnique({
      where: { agentDid: did },
    });

    if (!reputation) {
      return null;
    }

    return {
      reputationScore: reputation.reputationScore,
      successfulTxns: reputation.successfulTxns,
      failedTxns: reputation.failedTxns,
      totalVolume: reputation.totalVolume,
    };
  }

  /**
   * Update agent's reputation after a transaction
   */
  async updateReputation(did: string, success: boolean, amount?: number): Promise<void> {
    const reputation = await this.prisma.agentReputation.findUnique({
      where: { agentDid: did },
    });

    if (!reputation) {
      return;
    }

    const newSuccessful = reputation.successfulTxns + (success ? 1 : 0);
    const newFailed = reputation.failedTxns + (success ? 0 : 1);
    const totalTxns = newSuccessful + newFailed;
    const newVolume = reputation.totalVolume + (amount || 0);
    
    // Calculate reputation score (0-100)
    const successRate = totalTxns > 0 ? (newSuccessful / totalTxns) * 100 : 100;
    const newReputationScore = Math.max(0, Math.min(100, successRate));

    await this.prisma.agentReputation.update({
      where: { agentDid: did },
      data: {
        successfulTxns: newSuccessful,
        failedTxns: newFailed,
        totalVolume: newVolume,
        reputationScore: newReputationScore,
        lastUpdated: new Date(),
      },
    });
  }
}
