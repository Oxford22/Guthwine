/**
 * @guthwine/demo
 * 
 * Zero-dependency demo for Guthwine authorization system.
 * Run locally in under 10 minutes without Docker, PostgreSQL, or Redis.
 */

export { DemoService } from './services/demo-service.js';
export type { AuthorizationRequest, AuthorizationResult, DemoServiceConfig } from './services/demo-service.js';

export { MockLLMService } from './services/mock-llm.js';
export type { SemanticAnalysisRequest, SemanticAnalysisResult } from './services/mock-llm.js';

export { SqliteAdapter } from './adapters/sqlite-adapter.js';
export type { Agent, Policy, Transaction, AuditLog, Organization } from './adapters/sqlite-adapter.js';

export { MockRedisAdapter } from './adapters/mock-redis-adapter.js';
export type { RateLimitResult } from './adapters/mock-redis-adapter.js';

export { startServer } from './server.js';
