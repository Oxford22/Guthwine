/**
 * Guthwine - Rate Limiter Service
 * Flash crash prevention through sliding window rate limiting
 */

import { PrismaClient } from '@prisma/client';
import type { RateLimitConfig, RateLimitStatus } from '../types/index.js';

export class RateLimiter {
  private prisma: PrismaClient;
  private defaultConfig: RateLimitConfig;

  constructor(prisma: PrismaClient, config?: Partial<RateLimitConfig>) {
    this.prisma = prisma;
    this.defaultConfig = {
      windowSizeMs: config?.windowSizeMs || 60000, // 1 minute default
      maxAmount: config?.maxAmount || 100, // $100 default per window
      maxTransactions: config?.maxTransactions || 10, // 10 transactions per window
    };
  }

  /**
   * Check if a transaction would exceed rate limits
   */
  async checkLimit(
    agentDid: string,
    amount: number,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitStatus> {
    const effectiveConfig = { ...this.defaultConfig, ...config };
    const now = new Date();
    const windowStart = new Date(now.getTime() - effectiveConfig.windowSizeMs);

    // Get current window data
    const windowData = await this.prisma.rateLimitWindow.findUnique({
      where: { agentDid },
    });

    // If window exists but is old, treat as no data
    const isCurrentWindow = windowData && windowData.windowStart >= windowStart;
    
    const currentSpend = isCurrentWindow ? windowData.currentSpend : 0;
    const transactionCount = isCurrentWindow ? windowData.transactionCount : 0;
    const remainingBudget = effectiveConfig.maxAmount - currentSpend;

    // Check if adding this transaction would exceed limits
    const wouldExceedAmount = currentSpend + amount > effectiveConfig.maxAmount;
    const wouldExceedCount = transactionCount + 1 > effectiveConfig.maxTransactions;
    const isLimited = wouldExceedAmount || wouldExceedCount;

    return {
      isLimited,
      currentSpend,
      transactionCount,
      windowReset: new Date(windowStart.getTime() + effectiveConfig.windowSizeMs),
      remainingBudget: Math.max(0, remainingBudget),
    };
  }

  /**
   * Record a transaction in the rate limit window
   */
  async recordTransaction(
    agentDid: string,
    amount: number,
    config?: Partial<RateLimitConfig>
  ): Promise<void> {
    const effectiveConfig = { ...this.defaultConfig, ...config };
    const now = new Date();
    const windowStart = new Date(now.getTime() - effectiveConfig.windowSizeMs);

    // Find existing window
    const existingWindow = await this.prisma.rateLimitWindow.findUnique({
      where: { agentDid },
    });

    // Check if window is current
    const isCurrentWindow = existingWindow && existingWindow.windowStart >= windowStart;

    if (isCurrentWindow && existingWindow) {
      // Update existing window
      await this.prisma.rateLimitWindow.update({
        where: { agentDid },
        data: {
          currentSpend: existingWindow.currentSpend + amount,
          transactionCount: existingWindow.transactionCount + 1,
        },
      });
    } else {
      // Create or reset window
      await this.prisma.rateLimitWindow.upsert({
        where: { agentDid },
        update: {
          windowStart: now,
          currentSpend: amount,
          transactionCount: 1,
        },
        create: {
          agentDid,
          windowStart: now,
          currentSpend: amount,
          transactionCount: 1,
        },
      });
    }

    // Also record in transaction history for anomaly detection
    await this.prisma.transactionHistory.create({
      data: {
        agentDid,
        amount,
      },
    });
  }

  /**
   * Get rate limit status for an agent
   */
  async getStatus(agentDid: string, config?: Partial<RateLimitConfig>): Promise<RateLimitStatus> {
    return this.checkLimit(agentDid, 0, config);
  }

  /**
   * Reset rate limit for an agent (admin function)
   */
  async resetLimit(agentDid: string): Promise<void> {
    await this.prisma.rateLimitWindow.delete({
      where: { agentDid },
    }).catch(() => {
      // Ignore if not found
    });
  }

  /**
   * Get spending history for an agent
   */
  async getSpendingHistory(
    agentDid: string,
    hours: number = 24
  ): Promise<{ timestamp: Date; amount: number }[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const history = await this.prisma.transactionHistory.findMany({
      where: {
        agentDid,
        timestamp: { gte: cutoff },
      },
      orderBy: { timestamp: 'asc' },
    });

    return history.map((h) => ({
      timestamp: h.timestamp,
      amount: h.amount,
    }));
  }

  /**
   * Check for anomalous spending patterns
   */
  async detectAnomalies(
    agentDid: string,
    config?: {
      velocityThreshold?: number; // Transactions per minute
      amountThreshold?: number; // Amount per minute
      lookbackMinutes?: number;
    }
  ): Promise<{
    isAnomalous: boolean;
    reasons: string[];
    metrics: {
      velocity: number;
      amountPerMinute: number;
      totalInLookback: number;
    };
  }> {
    const velocityThreshold = config?.velocityThreshold || 5;
    const amountThreshold = config?.amountThreshold || 500;
    const lookbackMinutes = config?.lookbackMinutes || 5;

    const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000);

    const history = await this.prisma.transactionHistory.findMany({
      where: {
        agentDid,
        timestamp: { gte: cutoff },
      },
    });

    const totalTransactions = history.length;
    const totalAmount = history.reduce((sum, h) => sum + h.amount, 0);
    
    const velocity = totalTransactions / lookbackMinutes;
    const amountPerMinute = totalAmount / lookbackMinutes;

    const reasons: string[] = [];

    if (velocity > velocityThreshold) {
      reasons.push(
        `High transaction velocity: ${velocity.toFixed(2)}/min (threshold: ${velocityThreshold})`
      );
    }

    if (amountPerMinute > amountThreshold) {
      reasons.push(
        `High spending rate: $${amountPerMinute.toFixed(2)}/min (threshold: $${amountThreshold})`
      );
    }

    return {
      isAnomalous: reasons.length > 0,
      reasons,
      metrics: {
        velocity,
        amountPerMinute,
        totalInLookback: totalAmount,
      },
    };
  }
}
