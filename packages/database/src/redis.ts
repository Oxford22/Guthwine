/**
 * Guthwine - Redis Client
 * Caching, rate limiting, and pub/sub
 */

import { Redis } from 'ioredis';

// Redis client singleton
let redis: Redis | null = null;
let subscriber: Redis | null = null;

/**
 * Get Redis client instance
 */
export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redis.on('error', (err: Error) => {
      console.error('Redis connection error:', err);
    });

    redis.on('connect', () => {
      console.log('Redis connected');
    });
  }

  return redis;
}

/**
 * Get Redis subscriber instance (for pub/sub)
 */
export function getSubscriber(): Redis {
  if (!subscriber) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    subscriber = new Redis(url);
  }
  return subscriber;
}

/**
 * Connect to Redis
 */
export async function connectRedis(): Promise<void> {
  const client = getRedis();
  if (client.status === 'wait') {
    await client.connect();
  }
}

/**
 * Disconnect from Redis
 */
export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
}

/**
 * Check Redis health
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedis();
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

// =============================================================================
// CACHING
// =============================================================================

const DEFAULT_TTL = 3600; // 1 hour

/**
 * Get cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedis();
    const value = await client.get(key);
    if (value) {
      return JSON.parse(value) as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Set cached value
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  try {
    const client = getRedis();
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Delete cached value
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    const client = getRedis();
    await client.del(key);
  } catch (error) {
    console.error('Cache delete error:', error);
  }
}

/**
 * Delete cached values by pattern
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const client = getRedis();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch (error) {
    console.error('Cache delete pattern error:', error);
  }
}

/**
 * Get or set cached value
 */
export async function cacheGetOrSet<T>(
  key: string,
  factory: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  const value = await factory();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Check and increment rate limit
 * Returns remaining requests, or -1 if limit exceeded
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const client = getRedis();
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Use sorted set for sliding window
  const multi = client.multi();
  
  // Remove old entries
  multi.zremrangebyscore(key, 0, windowStart);
  
  // Count current entries
  multi.zcard(key);
  
  // Add new entry
  multi.zadd(key, now, `${now}-${Math.random()}`);
  
  // Set expiry
  multi.expire(key, windowSeconds);

  const results = await multi.exec();
  const count = (results?.[1]?.[1] as number) || 0;

  const allowed = count < limit;
  const remaining = Math.max(0, limit - count - 1);
  const resetAt = new Date(now + windowSeconds * 1000);

  return { allowed, remaining, resetAt };
}

/**
 * Get rate limit status without incrementing
 */
export async function getRateLimitStatus(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ current: number; limit: number; remaining: number; resetAt: Date }> {
  const client = getRedis();
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Remove old entries and count
  await client.zremrangebyscore(key, 0, windowStart);
  const count = await client.zcard(key);

  return {
    current: count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(now + windowSeconds * 1000),
  };
}

// =============================================================================
// DISTRIBUTED LOCKS
// =============================================================================

/**
 * Acquire a distributed lock
 */
export async function acquireLock(
  key: string,
  ttlSeconds: number = 30
): Promise<string | null> {
  const client = getRedis();
  const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lockKey = `lock:${key}`;

  const result = await client.set(lockKey, lockId, 'EX', ttlSeconds, 'NX');
  
  if (result === 'OK') {
    return lockId;
  }
  return null;
}

/**
 * Release a distributed lock
 */
export async function releaseLock(key: string, lockId: string): Promise<boolean> {
  const client = getRedis();
  const lockKey = `lock:${key}`;

  // Use Lua script for atomic check-and-delete
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  const result = await client.eval(script, 1, lockKey, lockId);
  return result === 1;
}

/**
 * Execute with lock
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = 30
): Promise<T> {
  const lockId = await acquireLock(key, ttlSeconds);
  if (!lockId) {
    throw new Error(`Failed to acquire lock: ${key}`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key, lockId);
  }
}

// =============================================================================
// PUB/SUB
// =============================================================================

type MessageHandler = (message: string) => void;
const subscriptions = new Map<string, Set<MessageHandler>>();

/**
 * Subscribe to a channel
 */
export async function subscribe(
  channel: string,
  handler: MessageHandler
): Promise<void> {
  const sub = getSubscriber();

  if (!subscriptions.has(channel)) {
    subscriptions.set(channel, new Set());
    await sub.subscribe(channel);
    
    sub.on('message', (ch: string, msg: string) => {
      if (ch === channel) {
        const handlers = subscriptions.get(channel);
        handlers?.forEach((h) => h(msg));
      }
    });
  }

  subscriptions.get(channel)?.add(handler);
}

/**
 * Unsubscribe from a channel
 */
export async function unsubscribe(
  channel: string,
  handler?: MessageHandler
): Promise<void> {
  const handlers = subscriptions.get(channel);
  if (!handlers) return;

  if (handler) {
    handlers.delete(handler);
  } else {
    handlers.clear();
  }

  if (handlers.size === 0) {
    const sub = getSubscriber();
    await sub.unsubscribe(channel);
    subscriptions.delete(channel);
  }
}

/**
 * Publish to a channel
 */
export async function publish(channel: string, message: string): Promise<void> {
  const client = getRedis();
  await client.publish(channel, message);
}

// =============================================================================
// EXPORT REDIS INSTANCE
// =============================================================================

export { redis };
