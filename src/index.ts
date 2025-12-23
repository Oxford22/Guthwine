/**
 * Guthwine - Sovereign Governance Layer for AI Agents
 * 
 * A comprehensive authorization, delegation, and audit system for AI agents
 * that provides:
 * - Agent identity management with DIDs
 * - Transaction authorization with policy evaluation
 * - Hierarchical delegation with JWT tokens
 * - Immutable audit trail with Merkle tree verification
 * - Rate limiting and anomaly detection
 * - Semantic firewall with LLM-based risk assessment
 * - MCP (Model Context Protocol) integration
 * - REST API for direct integration
 */

// Export types
export * from './types/index.js';

// Export services
export {
  GuthwineService,
  type GuthwineConfig,
  VaultService,
  IdentityService,
  DelegationService,
  PolicyEngine,
  LedgerService,
  RateLimiter,
  SemanticFirewall,
} from './services/index.js';

// Export server creators
export { createMCPServer, runMCPServer } from './mcp-server.js';
export { createHTTPServer, runHTTPServer } from './http-server.js';
