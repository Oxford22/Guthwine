/**
 * Guthwine - User Types
 * User management with role-based access control
 */

import { z } from 'zod';

// User roles with hierarchical permissions
export const UserRoleSchema = z.enum([
  'OWNER',       // Full access, can delete org
  'ADMIN',       // Full access except org deletion
  'MANAGER',     // Can manage agents, policies, delegations
  'OPERATOR',    // Can view and approve transactions
  'DEVELOPER',   // API access, can manage integrations
  'AUDITOR',     // Read-only access to audit logs
  'READONLY',    // Read-only access to dashboard
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

// User status
export const UserStatusSchema = z.enum([
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
  'DEACTIVATED',
]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

// Permission definitions
export const PermissionSchema = z.enum([
  // Organization
  'org:read',
  'org:update',
  'org:delete',
  'org:manage_billing',
  'org:manage_settings',
  
  // Users
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'users:manage_roles',
  
  // Agents
  'agents:read',
  'agents:create',
  'agents:update',
  'agents:delete',
  'agents:freeze',
  
  // Policies
  'policies:read',
  'policies:create',
  'policies:update',
  'policies:delete',
  
  // Delegations
  'delegations:read',
  'delegations:create',
  'delegations:revoke',
  
  // Transactions
  'transactions:read',
  'transactions:approve',
  'transactions:deny',
  
  // Audit
  'audit:read',
  'audit:export',
  
  // API
  'api:access',
  'api:manage_keys',
  
  // Integrations
  'integrations:read',
  'integrations:manage',
]);
export type Permission = z.infer<typeof PermissionSchema>;

// Role to permissions mapping
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    'org:read', 'org:update', 'org:delete', 'org:manage_billing', 'org:manage_settings',
    'users:read', 'users:create', 'users:update', 'users:delete', 'users:manage_roles',
    'agents:read', 'agents:create', 'agents:update', 'agents:delete', 'agents:freeze',
    'policies:read', 'policies:create', 'policies:update', 'policies:delete',
    'delegations:read', 'delegations:create', 'delegations:revoke',
    'transactions:read', 'transactions:approve', 'transactions:deny',
    'audit:read', 'audit:export',
    'api:access', 'api:manage_keys',
    'integrations:read', 'integrations:manage',
  ],
  ADMIN: [
    'org:read', 'org:update', 'org:manage_billing', 'org:manage_settings',
    'users:read', 'users:create', 'users:update', 'users:delete', 'users:manage_roles',
    'agents:read', 'agents:create', 'agents:update', 'agents:delete', 'agents:freeze',
    'policies:read', 'policies:create', 'policies:update', 'policies:delete',
    'delegations:read', 'delegations:create', 'delegations:revoke',
    'transactions:read', 'transactions:approve', 'transactions:deny',
    'audit:read', 'audit:export',
    'api:access', 'api:manage_keys',
    'integrations:read', 'integrations:manage',
  ],
  MANAGER: [
    'org:read',
    'users:read',
    'agents:read', 'agents:create', 'agents:update', 'agents:freeze',
    'policies:read', 'policies:create', 'policies:update',
    'delegations:read', 'delegations:create', 'delegations:revoke',
    'transactions:read', 'transactions:approve', 'transactions:deny',
    'audit:read',
    'api:access',
    'integrations:read',
  ],
  OPERATOR: [
    'org:read',
    'agents:read',
    'policies:read',
    'delegations:read',
    'transactions:read', 'transactions:approve', 'transactions:deny',
    'audit:read',
  ],
  DEVELOPER: [
    'org:read',
    'agents:read', 'agents:create', 'agents:update',
    'policies:read',
    'delegations:read',
    'transactions:read',
    'audit:read',
    'api:access', 'api:manage_keys',
    'integrations:read', 'integrations:manage',
  ],
  AUDITOR: [
    'org:read',
    'users:read',
    'agents:read',
    'policies:read',
    'delegations:read',
    'transactions:read',
    'audit:read', 'audit:export',
  ],
  READONLY: [
    'org:read',
    'agents:read',
    'policies:read',
    'delegations:read',
    'transactions:read',
    'audit:read',
  ],
};

// MFA method
export const MFAMethodSchema = z.enum([
  'TOTP',
  'SMS',
  'EMAIL',
  'WEBAUTHN',
]);
export type MFAMethod = z.infer<typeof MFAMethodSchema>;

// User preferences
export const UserPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  timezone: z.string().default('UTC'),
  locale: z.string().default('en-US'),
  notifications: z.object({
    email: z.boolean().default(true),
    push: z.boolean().default(true),
    transactionAlerts: z.boolean().default(true),
    securityAlerts: z.boolean().default(true),
    weeklyDigest: z.boolean().default(true),
  }),
  dashboard: z.object({
    defaultView: z.enum(['overview', 'agents', 'transactions', 'audit']).default('overview'),
    compactMode: z.boolean().default(false),
  }),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// User schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Identity
  email: z.string().email(),
  name: z.string().min(1).max(255),
  avatarUrl: z.string().url().nullable(),
  
  // Authentication
  passwordHash: z.string().nullable(), // Null for SSO users
  mfaEnabled: z.boolean().default(false),
  mfaMethod: MFAMethodSchema.nullable(),
  mfaSecret: z.string().nullable(),
  
  // SSO
  ssoProvider: z.string().nullable(),
  ssoSubject: z.string().nullable(),
  
  // Role and status
  role: UserRoleSchema,
  status: UserStatusSchema,
  
  // Custom permissions (override role defaults)
  customPermissions: z.array(PermissionSchema).default([]),
  deniedPermissions: z.array(PermissionSchema).default([]),
  
  // Preferences
  preferences: UserPreferencesSchema,
  
  // Session management
  lastLoginAt: z.date().nullable(),
  lastLoginIp: z.string().nullable(),
  lastLoginUserAgent: z.string().nullable(),
  failedLoginAttempts: z.number().default(0),
  lockedUntil: z.date().nullable(),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  invitedAt: z.date().nullable(),
  invitedBy: z.string().uuid().nullable(),
});
export type User = z.infer<typeof UserSchema>;

// Create user input
export const CreateUserInputSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: UserRoleSchema.default('READONLY'),
  sendInvite: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

// Update user input
export const UpdateUserInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
  customPermissions: z.array(PermissionSchema).optional(),
  deniedPermissions: z.array(PermissionSchema).optional(),
  preferences: UserPreferencesSchema.partial().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

// Session schema
export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  
  // Session data
  token: z.string(),
  refreshToken: z.string().nullable(),
  
  // Device info
  ipAddress: z.string(),
  userAgent: z.string(),
  deviceFingerprint: z.string().nullable(),
  
  // Timestamps
  createdAt: z.date(),
  expiresAt: z.date(),
  lastActivityAt: z.date(),
});
export type Session = z.infer<typeof SessionSchema>;

// API Key schema
export const APIKeySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdById: z.string().uuid(),
  
  name: z.string().min(1).max(255),
  keyHash: z.string(), // Hashed API key
  keyPrefix: z.string(), // First 8 chars for identification
  
  // Permissions
  permissions: z.array(PermissionSchema),
  
  // Rate limits
  rateLimitPerMinute: z.number().nullable(),
  
  // Usage tracking
  lastUsedAt: z.date().nullable(),
  usageCount: z.number().default(0),
  
  // Status
  isActive: z.boolean().default(true),
  expiresAt: z.date().nullable(),
  
  // Timestamps
  createdAt: z.date(),
  revokedAt: z.date().nullable(),
});
export type APIKey = z.infer<typeof APIKeySchema>;
