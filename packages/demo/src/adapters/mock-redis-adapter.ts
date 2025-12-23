/**
 * Mock Redis Adapter for Zero-Dependency Demo
 * 
 * Uses ioredis-mock for in-memory Redis emulation.
 * Supports rate limiting, nonce management, and pub/sub.
 */

import RedisMock from 'ioredis-mock';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export class MockRedisAdapter {
  private client: InstanceType<typeof RedisMock>;
  private subscriber: InstanceType<typeof RedisMock>;
  private publisher: InstanceType<typeof RedisMock>;
  private eventHandlers: Map<string, ((message: string) => void)[]> = new Map();

  constructor() {
    // Create shared mock instances for pub/sub
    this.client = new RedisMock();
    this.publisher = new RedisMock();
    this.subscriber = new RedisMock();

    // Set up subscription handling
    this.subscriber.on('message', (channel: string, message: string) => {
      const handlers = this.eventHandlers.get(channel) || [];
      handlers.forEach(handler => handler(message));
    });
  }

  // Rate Limiting with Token Bucket Algorithm
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;
    
    // Use INCR for atomic counter
    const current = await this.client.incr(windowKey);
    
    // Set expiry on first increment
    if (current === 1) {
      await this.client.expire(windowKey, windowSeconds);
    }

    const allowed = current <= limit;
    const remaining = Math.max(0, limit - current);
    const resetAt = new Date(Math.ceil(now / (windowSeconds * 1000)) * windowSeconds * 1000);

    return { allowed, remaining, resetAt };
  }

  // Sliding Window Rate Limiting (more accurate)
  async checkSlidingWindowRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;
    const setKey = `ratelimit:sliding:${key}`;

    // Remove old entries
    await this.client.zremrangebyscore(setKey, 0, windowStart);

    // Count current entries
    const count = await this.client.zcard(setKey);

    if (count < limit) {
      // Add new entry
      await this.client.zadd(setKey, now.toString(), `${now}:${Math.random()}`);
      await this.client.expire(setKey, windowSeconds);
      
      return {
        allowed: true,
        remaining: limit - count - 1,
        resetAt: new Date(now + windowMs)
      };
    }

    // Get oldest entry to calculate reset time
    const oldest = await this.client.zrange(setKey, 0, 0, 'WITHSCORES');
    const resetAt = oldest.length >= 2 && oldest[1]
      ? new Date(parseInt(oldest[1] as string) + windowMs)
      : new Date(now + windowMs);

    return {
      allowed: false,
      remaining: 0,
      resetAt
    };
  }

  // Nonce Management for Replay Protection
  async checkAndStoreNonce(nonce: string, ttlSeconds: number = 300): Promise<boolean> {
    const key = `nonce:${nonce}`;
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async isNonceUsed(nonce: string): Promise<boolean> {
    const result = await this.client.exists(`nonce:${nonce}`);
    return result === 1;
  }

  // Budget Tracking
  async getBudgetRemaining(agentId: string, period: string): Promise<number> {
    const key = `budget:${agentId}:${period}`;
    const value = await this.client.get(key);
    return value ? parseFloat(value) : 0;
  }

  async decrementBudget(
    agentId: string,
    period: string,
    amount: number,
    limit: number
  ): Promise<{ success: boolean; remaining: number }> {
    const key = `budget:${agentId}:${period}`;
    
    // Atomic check and decrement using Lua script
    const script = `
      local current = tonumber(redis.call('GET', KEYS[1])) or 0
      local amount = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      
      if current + amount > limit then
        return {0, current}
      end
      
      local newValue = current + amount
      redis.call('SET', KEYS[1], newValue)
      return {1, newValue}
    `;

    try {
      const result = await this.client.eval(script, 1, key, amount.toString(), limit.toString()) as [number, number];
      return {
        success: result[0] === 1,
        remaining: limit - result[1]
      };
    } catch {
      // Fallback for mock limitations
      const current = await this.getBudgetRemaining(agentId, period);
      if (current + amount > limit) {
        return { success: false, remaining: limit - current };
      }
      await this.client.set(key, (current + amount).toString());
      return { success: true, remaining: limit - current - amount };
    }
  }

  async resetBudget(agentId: string, period: string): Promise<void> {
    const key = `budget:${agentId}:${period}`;
    await this.client.del(key);
  }

  // Caching
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // Pub/Sub for Real-time Events
  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
    
    // Also trigger local handlers (for in-process events)
    const handlers = this.eventHandlers.get(channel) || [];
    handlers.forEach(handler => handler(message));
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    const handlers = this.eventHandlers.get(channel) || [];
    handlers.push(handler);
    this.eventHandlers.set(channel, handlers);
    
    await this.subscriber.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.eventHandlers.delete(channel);
    await this.subscriber.unsubscribe(channel);
  }

  // Session Management
  async setSession(sessionId: string, data: Record<string, unknown>, ttlSeconds: number = 3600): Promise<void> {
    const key = `session:${sessionId}`;
    await this.client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const key = `session:${sessionId}`;
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.del(`session:${sessionId}`);
  }

  // Cleanup
  async flushAll(): Promise<void> {
    await this.client.flushall();
  }

  async close(): Promise<void> {
    this.client.disconnect();
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }

  // Stats
  async getStats(): Promise<{ keys: number; memory: string }> {
    const keys = await this.client.dbsize();
    return {
      keys,
      memory: 'N/A (in-memory mock)'
    };
  }
}

export default MockRedisAdapter;
