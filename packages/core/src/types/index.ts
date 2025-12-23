/**
 * Guthwine - Core Types
 * Export all type definitions
 */

export * from './organization.js';
export * from './user.js';
export * from './agent.js';
export * from './policy.js';
export * from './delegation.js';
export * from './transaction.js';
export * from './audit.js';

// Common utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

// Result type for operations
export interface Result<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

// Pagination
export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// Time range
export interface TimeRange {
  start: Date;
  end: Date;
}

// Sort options
export interface SortOptions<T extends string = string> {
  field: T;
  order: 'asc' | 'desc';
}

// Filter operators
export type FilterOperator = 
  | 'eq' 
  | 'ne' 
  | 'gt' 
  | 'gte' 
  | 'lt' 
  | 'lte' 
  | 'in' 
  | 'nin' 
  | 'contains' 
  | 'startsWith' 
  | 'endsWith';

export interface FilterCondition<T = unknown> {
  field: string;
  operator: FilterOperator;
  value: T;
}

// Event types for real-time updates
export type EventType = 
  | 'transaction.requested'
  | 'transaction.approved'
  | 'transaction.denied'
  | 'transaction.executed'
  | 'agent.created'
  | 'agent.frozen'
  | 'agent.unfrozen'
  | 'delegation.created'
  | 'delegation.revoked'
  | 'policy.created'
  | 'policy.updated'
  | 'anomaly.detected'
  | 'rate_limit.exceeded';

export interface GuthwineEvent<T = unknown> {
  type: EventType;
  organizationId: string;
  timestamp: Date;
  payload: T;
  correlationId?: string;
}

// Webhook payload
export interface WebhookPayload<T = unknown> {
  id: string;
  type: EventType;
  apiVersion: string;
  created: number;
  data: T;
  organizationId: string;
}

// Health check
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: {
    database: boolean;
    redis: boolean;
    vectorDb: boolean;
    llmProvider: boolean;
  };
  timestamp: Date;
}
