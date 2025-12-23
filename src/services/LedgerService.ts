/**
 * Guthwine - Ledger Service
 * Immutable audit log with Merkle tree linking for tamper-evidence
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { VaultService } from './VaultService.js';
import type { 
  AuditEntry, 
  AuditActionType, 
  TransactionDecisionType 
} from '../types/index.js';

export class LedgerService {
  private prisma: PrismaClient;
  private vault: VaultService;

  constructor(prisma: PrismaClient, vault: VaultService) {
    this.prisma = prisma;
    this.vault = vault;
  }

  /**
   * Create a hash of the audit entry data
   */
  private hashEntry(data: string, previousHash: string | null): string {
    const content = previousHash ? `${previousHash}:${data}` : data;
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Serialize entry data for hashing (consistent format)
   */
  private serializeEntryData(entry: {
    id: number;
    agentDid: string;
    action: string;
    transactionType?: string | null;
    amount?: number | null;
    currency?: string | null;
    merchantId?: string | null;
    reasoningTrace?: string | null;
    policySnapshotId?: string | null;
    decision: string;
    decisionReason?: string | null;
    delegationChain?: string[] | null;
  }): string {
    return JSON.stringify({
      id: entry.id,
      agentDid: entry.agentDid,
      action: entry.action,
      transactionType: entry.transactionType || null,
      amount: entry.amount || null,
      currency: entry.currency || null,
      merchantId: entry.merchantId || null,
      reasoningTrace: entry.reasoningTrace || null,
      policySnapshotId: entry.policySnapshotId || null,
      decision: entry.decision,
      decisionReason: entry.decisionReason || null,
      delegationChain: entry.delegationChain || null,
    });
  }

  /**
   * Record an audit entry
   */
  async recordEntry(entry: AuditEntry): Promise<number> {
    // Get the last entry to chain the hash
    const lastEntry = await this.prisma.auditLog.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true, entryHash: true },
    });

    const previousHash = lastEntry?.entryHash || null;
    const nextId = (lastEntry?.id || 0) + 1;

    // Serialize entry data for hashing
    const entryData = this.serializeEntryData({
      id: nextId,
      agentDid: entry.agentDid,
      action: entry.action,
      transactionType: entry.transactionType,
      amount: entry.amount,
      currency: entry.currency,
      merchantId: entry.merchantId,
      reasoningTrace: entry.reasoningTrace,
      policySnapshotId: entry.policySnapshotId,
      decision: entry.decision,
      decisionReason: entry.decisionReason,
      delegationChain: entry.delegationChain,
    });

    // Create Merkle-linked hash
    const entryHash = this.hashEntry(entryData, previousHash);

    // Store the entry
    const auditLog = await this.prisma.auditLog.create({
      data: {
        agentDid: entry.agentDid,
        action: entry.action,
        transactionType: entry.transactionType,
        amount: entry.amount,
        currency: entry.currency,
        merchantId: entry.merchantId,
        reasoningTrace: entry.reasoningTrace,
        policySnapshotId: entry.policySnapshotId,
        decision: entry.decision,
        decisionReason: entry.decisionReason,
        previousHash,
        entryHash,
        delegationChain: entry.delegationChain ? JSON.stringify(entry.delegationChain) : null,
      },
    });

    return auditLog.id;
  }

  /**
   * Verify the integrity of the audit log chain
   */
  async verifyChainIntegrity(startId?: number, endId?: number): Promise<{
    valid: boolean;
    errors: string[];
    entriesChecked: number;
  }> {
    const errors: string[] = [];
    
    const where: any = {};
    if (startId !== undefined) {
      where.id = { gte: startId };
    }
    if (endId !== undefined) {
      where.id = { ...where.id, lte: endId };
    }

    const entries = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'asc' },
    });

    let previousHash: string | null = null;

    // If we're not starting from the beginning, get the previous hash
    if (startId && startId > 1) {
      const prevEntry = await this.prisma.auditLog.findFirst({
        where: { id: startId - 1 },
        select: { entryHash: true },
      });
      previousHash = prevEntry?.entryHash || null;
    }

    for (const entry of entries) {
      // Verify previous hash link
      if (entry.previousHash !== previousHash) {
        errors.push(
          `Chain broken at id ${entry.id}: ` +
          `expected previousHash ${previousHash}, got ${entry.previousHash}`
        );
      }

      // Reconstruct and verify the hash
      const entryData = this.serializeEntryData({
        id: entry.id,
        agentDid: entry.agentDid,
        action: entry.action,
        transactionType: entry.transactionType,
        amount: entry.amount,
        currency: entry.currency,
        merchantId: entry.merchantId,
        reasoningTrace: entry.reasoningTrace,
        policySnapshotId: entry.policySnapshotId,
        decision: entry.decision,
        decisionReason: entry.decisionReason,
        delegationChain: entry.delegationChain ? JSON.parse(entry.delegationChain) : null,
      });

      const expectedHash = this.hashEntry(entryData, entry.previousHash);
      if (entry.entryHash !== expectedHash) {
        errors.push(
          `Hash mismatch at id ${entry.id}: ` +
          `data may have been tampered with`
        );
      }

      previousHash = entry.entryHash;
    }

    return {
      valid: errors.length === 0,
      errors,
      entriesChecked: entries.length,
    };
  }

  /**
   * Get audit trail for an agent
   */
  async getAuditTrail(options: {
    agentDid?: string;
    startTime?: Date;
    endTime?: Date;
    action?: AuditActionType;
    decision?: TransactionDecisionType;
    limit?: number;
    offset?: number;
  }): Promise<{
    entries: any[];
    total: number;
    hasMore: boolean;
  }> {
    const where: any = {};

    if (options.agentDid) {
      where.agentDid = options.agentDid;
    }

    if (options.startTime || options.endTime) {
      where.createdAt = {};
      if (options.startTime) {
        where.createdAt.gte = options.startTime;
      }
      if (options.endTime) {
        where.createdAt.lte = options.endTime;
      }
    }

    if (options.action) {
      where.action = options.action;
    }

    if (options.decision) {
      where.decision = options.decision;
    }

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        agentDid: e.agentDid,
        action: e.action,
        transactionType: e.transactionType,
        amount: e.amount,
        currency: e.currency,
        merchantId: e.merchantId,
        reasoningTrace: e.reasoningTrace,
        decision: e.decision,
        decisionReason: e.decisionReason,
        delegationChain: e.delegationChain ? JSON.parse(e.delegationChain) : null,
        entryHash: e.entryHash,
        verified: true,
      })),
      total,
      hasMore: offset + entries.length < total,
    };
  }

  /**
   * Get a specific audit entry by ID
   */
  async getEntry(id: number): Promise<any | null> {
    const entry = await this.prisma.auditLog.findUnique({
      where: { id },
    });

    if (!entry) {
      return null;
    }

    return {
      id: entry.id,
      createdAt: entry.createdAt,
      agentDid: entry.agentDid,
      action: entry.action,
      transactionType: entry.transactionType,
      amount: entry.amount,
      currency: entry.currency,
      merchantId: entry.merchantId,
      reasoningTrace: entry.reasoningTrace,
      decision: entry.decision,
      decisionReason: entry.decisionReason,
      delegationChain: entry.delegationChain ? JSON.parse(entry.delegationChain) : null,
      entryHash: entry.entryHash,
      previousHash: entry.previousHash,
    };
  }

  /**
   * Build Merkle root for a range of entries
   */
  async buildMerkleRoot(startId: number, endId: number): Promise<string> {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        id: { gte: startId, lte: endId },
      },
      orderBy: { id: 'asc' },
      select: { entryHash: true },
    });

    if (entries.length === 0) {
      throw new Error('No entries found in range');
    }

    // Build Merkle tree
    let hashes = entries.map((e) => e.entryHash);

    while (hashes.length > 1) {
      const newLevel: string[] = [];
      for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = hashes[i + 1] || left; // Duplicate last if odd
        const combined = crypto
          .createHash('sha256')
          .update(left + right)
          .digest('hex');
        newLevel.push(combined);
      }
      hashes = newLevel;
    }

    const rootHash = hashes[0];

    // Store the Merkle root
    await this.prisma.merkleRoot.create({
      data: {
        rootHash,
        startId,
        endId,
      },
    });

    return rootHash;
  }

  /**
   * Verify a Merkle root
   */
  async verifyMerkleRoot(rootHash: string): Promise<{
    valid: boolean;
    startId: number;
    endId: number;
  } | null> {
    const root = await this.prisma.merkleRoot.findFirst({
      where: { rootHash },
    });

    if (!root) {
      return null;
    }

    // Rebuild and verify
    const rebuiltRoot = await this.buildMerkleRoot(root.startId, root.endId);

    return {
      valid: rebuiltRoot === rootHash,
      startId: root.startId,
      endId: root.endId,
    };
  }
}
