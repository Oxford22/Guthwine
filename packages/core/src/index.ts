/**
 * Guthwine Core Package
 * Sovereign Governance Layer for AI Agents
 * 
 * This package provides:
 * - Type definitions for all Guthwine entities
 * - Cryptographic primitives (key management, JWT, Merkle trees)
 * - Custom error classes
 * - Utility functions
 */

// Types
export * from './types/index.js';

// Crypto
export * from './crypto/index.js';

// Errors
export * from './errors/index.js';

// Utils
export * from './utils/index.js';

// Version
export const VERSION = '2.0.0';
