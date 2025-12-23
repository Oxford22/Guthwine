/**
 * HSM (Hardware Security Module) Abstraction
 * 
 * Provides a unified interface for:
 * - Local software keys (development)
 * - AWS CloudHSM
 * - GCP Cloud KMS
 * - Azure Key Vault
 * - HashiCorp Vault
 */

export * from './interface.js';
export * from './local.js';
export * from './manager.js';
