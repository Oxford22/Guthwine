/**
 * Guthwine Permission Matrix
 * 
 * This is the compile-time checked permission system.
 * All permissions are defined here and validated at compile time.
 */

// =============================================================================
// RESOURCE DEFINITIONS
// =============================================================================

export const RESOURCES = [
  'organizations',
  'users',
  'agents',
  'policies',
  'delegations',
  'transactions',
  'audit',
  'billing',
  'api_keys',
  'webhooks',
  'compliance',
  'settings',
] as const;

export type Resource = typeof RESOURCES[number];

// =============================================================================
// ACTION DEFINITIONS
// =============================================================================

export const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'list',
  'freeze',
  'unfreeze',
  'export',
  'simulate',
  'execute',
] as const;

export type Action = typeof ACTIONS[number];

// =============================================================================
// PERMISSION STRING TYPE
// =============================================================================

export type PermissionString = `${Resource}:${Action}`;

// Helper to create type-safe permission strings
export function permission<R extends Resource, A extends Action>(
  resource: R,
  action: A
): `${R}:${A}` {
  return `${resource}:${action}`;
}

// =============================================================================
// ROLE DEFINITIONS
// =============================================================================

export const ROLES = [
  'OWNER',
  'ADMIN',
  'POLICY_MANAGER',
  'AGENT_OPERATOR',
  'DEVELOPER',
  'AUDITOR',
  'READONLY',
] as const;

export type Role = typeof ROLES[number];

// =============================================================================
// PERMISSION MATRIX
// =============================================================================

/**
 * The permission matrix defines which roles have which permissions.
 * This is checked at compile time to ensure type safety.
 */
export const PERMISSION_MATRIX: Record<Role, readonly PermissionString[]> = {
  OWNER: [
    // Organizations - full control
    'organizations:create',
    'organizations:read',
    'organizations:update',
    'organizations:delete',
    'organizations:list',
    
    // Users - full control
    'users:create',
    'users:read',
    'users:update',
    'users:delete',
    'users:list',
    
    // Agents - full control
    'agents:create',
    'agents:read',
    'agents:update',
    'agents:delete',
    'agents:list',
    'agents:freeze',
    'agents:unfreeze',
    
    // Policies - full control
    'policies:create',
    'policies:read',
    'policies:update',
    'policies:delete',
    'policies:list',
    'policies:simulate',
    
    // Delegations - full control
    'delegations:create',
    'delegations:read',
    'delegations:update',
    'delegations:delete',
    'delegations:list',
    
    // Transactions - full control
    'transactions:create',
    'transactions:read',
    'transactions:update',
    'transactions:delete',
    'transactions:list',
    'transactions:execute',
    
    // Audit - full control
    'audit:read',
    'audit:list',
    'audit:export',
    
    // Billing - full control
    'billing:read',
    'billing:update',
    'billing:list',
    
    // API Keys - full control
    'api_keys:create',
    'api_keys:read',
    'api_keys:update',
    'api_keys:delete',
    'api_keys:list',
    
    // Webhooks - full control
    'webhooks:create',
    'webhooks:read',
    'webhooks:update',
    'webhooks:delete',
    'webhooks:list',
    
    // Compliance - full control
    'compliance:read',
    'compliance:list',
    'compliance:export',
    
    // Settings - full control
    'settings:read',
    'settings:update',
  ],
  
  ADMIN: [
    // Organizations - no delete
    'organizations:read',
    'organizations:update',
    'organizations:list',
    
    // Users - full control
    'users:create',
    'users:read',
    'users:update',
    'users:delete',
    'users:list',
    
    // Agents - full control
    'agents:create',
    'agents:read',
    'agents:update',
    'agents:delete',
    'agents:list',
    'agents:freeze',
    'agents:unfreeze',
    
    // Policies - full control
    'policies:create',
    'policies:read',
    'policies:update',
    'policies:delete',
    'policies:list',
    'policies:simulate',
    
    // Delegations - full control
    'delegations:create',
    'delegations:read',
    'delegations:update',
    'delegations:delete',
    'delegations:list',
    
    // Transactions - full control
    'transactions:create',
    'transactions:read',
    'transactions:update',
    'transactions:delete',
    'transactions:list',
    'transactions:execute',
    
    // Audit - full control
    'audit:read',
    'audit:list',
    'audit:export',
    
    // Billing - read only
    'billing:read',
    'billing:list',
    
    // API Keys - full control
    'api_keys:create',
    'api_keys:read',
    'api_keys:update',
    'api_keys:delete',
    'api_keys:list',
    
    // Webhooks - full control
    'webhooks:create',
    'webhooks:read',
    'webhooks:update',
    'webhooks:delete',
    'webhooks:list',
    
    // Compliance - full control
    'compliance:read',
    'compliance:list',
    'compliance:export',
    
    // Settings - full control
    'settings:read',
    'settings:update',
  ],
  
  POLICY_MANAGER: [
    // Organizations - read only
    'organizations:read',
    
    // Users - read only
    'users:read',
    'users:list',
    
    // Agents - read only
    'agents:read',
    'agents:list',
    
    // Policies - full control
    'policies:create',
    'policies:read',
    'policies:update',
    'policies:delete',
    'policies:list',
    'policies:simulate',
    
    // Delegations - read only
    'delegations:read',
    'delegations:list',
    
    // Transactions - read only
    'transactions:read',
    'transactions:list',
    
    // Audit - read only
    'audit:read',
    'audit:list',
    
    // Settings - read only
    'settings:read',
  ],
  
  AGENT_OPERATOR: [
    // Organizations - read only
    'organizations:read',
    
    // Users - read only
    'users:read',
    'users:list',
    
    // Agents - full control
    'agents:create',
    'agents:read',
    'agents:update',
    'agents:delete',
    'agents:list',
    'agents:freeze',
    'agents:unfreeze',
    
    // Policies - read only
    'policies:read',
    'policies:list',
    
    // Delegations - full control
    'delegations:create',
    'delegations:read',
    'delegations:update',
    'delegations:delete',
    'delegations:list',
    
    // Transactions - read and execute
    'transactions:read',
    'transactions:list',
    'transactions:execute',
    
    // Audit - read only
    'audit:read',
    'audit:list',
    
    // Settings - read only
    'settings:read',
  ],
  
  DEVELOPER: [
    // Organizations - read only
    'organizations:read',
    
    // Agents - read only
    'agents:read',
    'agents:list',
    
    // Policies - read only
    'policies:read',
    'policies:list',
    
    // Delegations - read only
    'delegations:read',
    'delegations:list',
    
    // Transactions - read only
    'transactions:read',
    'transactions:list',
    
    // API Keys - manage own
    'api_keys:create',
    'api_keys:read',
    'api_keys:delete',
    'api_keys:list',
    
    // Webhooks - read only
    'webhooks:read',
    'webhooks:list',
    
    // Settings - read only
    'settings:read',
  ],
  
  AUDITOR: [
    // Organizations - read only
    'organizations:read',
    
    // Users - read only
    'users:read',
    'users:list',
    
    // Agents - read only
    'agents:read',
    'agents:list',
    
    // Policies - read only
    'policies:read',
    'policies:list',
    
    // Delegations - read only
    'delegations:read',
    'delegations:list',
    
    // Transactions - read only
    'transactions:read',
    'transactions:list',
    
    // Audit - full read access
    'audit:read',
    'audit:list',
    'audit:export',
    
    // Compliance - full read access
    'compliance:read',
    'compliance:list',
    'compliance:export',
  ],
  
  READONLY: [
    // Organizations - read only
    'organizations:read',
    
    // Users - read only
    'users:read',
    'users:list',
    
    // Agents - read only
    'agents:read',
    'agents:list',
    
    // Policies - read only
    'policies:read',
    'policies:list',
    
    // Delegations - read only
    'delegations:read',
    'delegations:list',
    
    // Transactions - read only
    'transactions:read',
    'transactions:list',
    
    // Audit - read only
    'audit:read',
    'audit:list',
    
    // Settings - read only
    'settings:read',
  ],
} as const;

// =============================================================================
// PERMISSION CHECKING UTILITIES
// =============================================================================

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, perm: PermissionString): boolean {
  const permissions = PERMISSION_MATRIX[role];
  return permissions.includes(perm);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: Role, perms: PermissionString[]): boolean {
  return perms.some(perm => hasPermission(role, perm));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: Role, perms: PermissionString[]): boolean {
  return perms.every(perm => hasPermission(role, perm));
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: Role): readonly PermissionString[] {
  return PERMISSION_MATRIX[role];
}

/**
 * Check if a user (with role + custom permissions) has a specific permission
 */
export function userHasPermission(
  role: Role,
  customPermissions: string[],
  deniedPermissions: string[],
  perm: PermissionString
): boolean {
  // Denied permissions always win
  if (deniedPermissions.includes(perm)) {
    return false;
  }
  
  // Check custom permissions
  if (customPermissions.includes(perm)) {
    return true;
  }
  
  // Check role permissions
  return hasPermission(role, perm);
}

// =============================================================================
// API KEY SCOPE PERMISSIONS
// =============================================================================

export const API_KEY_SCOPE_PERMISSIONS: Record<string, PermissionString[]> = {
  READ: [
    'organizations:read',
    'agents:read',
    'agents:list',
    'policies:read',
    'policies:list',
    'delegations:read',
    'delegations:list',
    'transactions:read',
    'transactions:list',
    'audit:read',
    'audit:list',
  ],
  WRITE: [
    'agents:create',
    'agents:update',
    'agents:freeze',
    'agents:unfreeze',
    'policies:create',
    'policies:update',
    'policies:simulate',
    'delegations:create',
    'delegations:update',
    'transactions:create',
    'transactions:execute',
  ],
  ADMIN: [
    'agents:delete',
    'policies:delete',
    'delegations:delete',
    'transactions:delete',
    'api_keys:create',
    'api_keys:update',
    'api_keys:delete',
    'webhooks:create',
    'webhooks:update',
    'webhooks:delete',
    'settings:update',
  ],
  BILLING: [
    'billing:read',
    'billing:update',
    'billing:list',
  ],
};

/**
 * Get all permissions for a set of API key scopes
 */
export function getApiKeyPermissions(scopes: string[]): PermissionString[] {
  const permissions = new Set<PermissionString>();
  
  for (const scope of scopes) {
    const scopePerms = API_KEY_SCOPE_PERMISSIONS[scope];
    if (scopePerms) {
      for (const perm of scopePerms) {
        permissions.add(perm);
      }
    }
  }
  
  return Array.from(permissions);
}

// =============================================================================
// PERMISSION MIDDLEWARE HELPERS
// =============================================================================

/**
 * Create a permission check function for a specific permission
 */
export function requirePermission(perm: PermissionString) {
  return (role: Role, customPermissions: string[] = [], deniedPermissions: string[] = []) => {
    return userHasPermission(role, customPermissions, deniedPermissions, perm);
  };
}

/**
 * Create a permission check function for any of the specified permissions
 */
export function requireAnyPermission(perms: PermissionString[]) {
  return (role: Role, customPermissions: string[] = [], deniedPermissions: string[] = []) => {
    return perms.some(perm => userHasPermission(role, customPermissions, deniedPermissions, perm));
  };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PermissionCheck = (
  role: Role,
  customPermissions?: string[],
  deniedPermissions?: string[]
) => boolean;
