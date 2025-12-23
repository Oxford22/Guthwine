/**
 * SSO & Access Control Service
 * 
 * Features:
 * - SAML 2.0 SP implementation
 * - OIDC provider integration
 * - SCIM 2.0 user provisioning
 * - Fine-grained RBAC with permission matrix
 */

import { prisma, Prisma, User, Organization } from '@guthwine/database';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { z } from 'zod';

// =============================================================================
// TYPES
// =============================================================================

export type UserRole = 'OWNER' | 'ADMIN' | 'POLICY_MANAGER' | 'AGENT_OPERATOR' | 'AUDITOR' | 'READONLY';
export type Permission = 
  | 'org:read' | 'org:update' | 'org:delete' | 'org:billing'
  | 'users:read' | 'users:create' | 'users:update' | 'users:delete' | 'users:roles'
  | 'agents:read' | 'agents:create' | 'agents:update' | 'agents:delete' | 'agents:freeze'
  | 'policies:read' | 'policies:create' | 'policies:update' | 'policies:delete' | 'policies:simulate'
  | 'delegations:read' | 'delegations:create' | 'delegations:revoke'
  | 'transactions:read' | 'transactions:approve' | 'transactions:reject'
  | 'audit:read' | 'audit:export'
  | 'api_keys:read' | 'api_keys:create' | 'api_keys:revoke';

// Permission matrix - compile-time checked
export const PERMISSION_MATRIX: Record<UserRole, Permission[]> = {
  OWNER: [
    'org:read', 'org:update', 'org:delete', 'org:billing',
    'users:read', 'users:create', 'users:update', 'users:delete', 'users:roles',
    'agents:read', 'agents:create', 'agents:update', 'agents:delete', 'agents:freeze',
    'policies:read', 'policies:create', 'policies:update', 'policies:delete', 'policies:simulate',
    'delegations:read', 'delegations:create', 'delegations:revoke',
    'transactions:read', 'transactions:approve', 'transactions:reject',
    'audit:read', 'audit:export',
    'api_keys:read', 'api_keys:create', 'api_keys:revoke',
  ],
  ADMIN: [
    'org:read', 'org:update',
    'users:read', 'users:create', 'users:update', 'users:delete',
    'agents:read', 'agents:create', 'agents:update', 'agents:delete', 'agents:freeze',
    'policies:read', 'policies:create', 'policies:update', 'policies:delete', 'policies:simulate',
    'delegations:read', 'delegations:create', 'delegations:revoke',
    'transactions:read', 'transactions:approve', 'transactions:reject',
    'audit:read', 'audit:export',
    'api_keys:read', 'api_keys:create', 'api_keys:revoke',
  ],
  POLICY_MANAGER: [
    'org:read',
    'users:read',
    'agents:read',
    'policies:read', 'policies:create', 'policies:update', 'policies:delete', 'policies:simulate',
    'delegations:read',
    'transactions:read',
    'audit:read',
  ],
  AGENT_OPERATOR: [
    'org:read',
    'users:read',
    'agents:read', 'agents:create', 'agents:update', 'agents:freeze',
    'policies:read',
    'delegations:read', 'delegations:create', 'delegations:revoke',
    'transactions:read', 'transactions:approve', 'transactions:reject',
    'audit:read',
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
  ],
};

export interface SAMLConfig {
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  certificate: string;
  signatureAlgorithm: 'sha256' | 'sha512';
  digestAlgorithm: 'sha256' | 'sha512';
  wantAssertionsSigned: boolean;
  wantMessagesSigned: boolean;
  attributeMapping: {
    email: string;
    firstName?: string;
    lastName?: string;
    groups?: string;
  };
}

export interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  jwksUrl: string;
  scopes: string[];
  claimMapping: {
    email: string;
    firstName?: string;
    lastName?: string;
    groups?: string;
  };
}

export interface SCIMUser {
  schemas: string[];
  id?: string;
  ssoSubject?: string;
  userName: string;
  name?: {
    givenName?: string;
    familyName?: string;
    formatted?: string;
  };
  emails?: Array<{
    value: string;
    type?: string;
    primary?: boolean;
  }>;
  active?: boolean;
  groups?: Array<{
    value: string;
    display?: string;
  }>;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
  };
}

export interface SCIMGroup {
  schemas: string[];
  id?: string;
  displayName: string;
  members?: Array<{
    value: string;
    display?: string;
  }>;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
  };
}

export interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    organizationId: string;
    role: UserRole;
    permissions: Permission[];
  };
  token?: string;
  error?: string;
}

// =============================================================================
// SAML SERVICE PROVIDER
// =============================================================================

export class SAMLServiceProvider {
  private config: SAMLConfig;
  private organizationId: string;

  constructor(organizationId: string, config: SAMLConfig) {
    this.organizationId = organizationId;
    this.config = config;
  }

  /**
   * Generate SAML AuthnRequest
   */
  generateAuthnRequest(relayState?: string): { url: string; requestId: string } {
    const requestId = `_${crypto.randomUUID()}`;
    const issueInstant = new Date().toISOString();

    const authnRequest = `
      <samlp:AuthnRequest
        xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
        xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
        ID="${requestId}"
        Version="2.0"
        IssueInstant="${issueInstant}"
        Destination="${this.config.ssoUrl}"
        AssertionConsumerServiceURL="${this.config.entityId}/acs"
        ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
        <saml:Issuer>${this.config.entityId}</saml:Issuer>
        <samlp:NameIDPolicy
          Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
          AllowCreate="true"/>
      </samlp:AuthnRequest>
    `.trim();

    const encodedRequest = Buffer.from(authnRequest).toString('base64');
    const url = new URL(this.config.ssoUrl);
    url.searchParams.set('SAMLRequest', encodedRequest);
    if (relayState) {
      url.searchParams.set('RelayState', relayState);
    }

    return { url: url.toString(), requestId };
  }

  /**
   * Validate SAML Response
   */
  async validateResponse(samlResponse: string): Promise<{
    valid: boolean;
    attributes?: Record<string, string>;
    error?: string;
  }> {
    try {
      const decoded = Buffer.from(samlResponse, 'base64').toString('utf-8');
      
      // In production, use a proper SAML library like saml2-js or passport-saml
      // This is a simplified implementation for demonstration
      
      // Verify signature
      if (this.config.wantAssertionsSigned || this.config.wantMessagesSigned) {
        // Verify XML signature using the IdP certificate
        // This would use xmldsig library in production
      }

      // Extract attributes
      const attributes: Record<string, string> = {};
      
      // Parse email
      const emailMatch = decoded.match(/<saml:Attribute Name="[^"]*email[^"]*"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/i);
      if (emailMatch && emailMatch[1]) {
        attributes.email = emailMatch[1];
      }

      // Parse name
      const nameMatch = decoded.match(/<saml:Attribute Name="[^"]*name[^"]*"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/i);
      if (nameMatch && nameMatch[1]) {
        attributes.name = nameMatch[1];
      }

      return { valid: true, attributes };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Generate SAML Metadata
   */
  generateMetadata(): string {
    return `
      <?xml version="1.0" encoding="UTF-8"?>
      <md:EntityDescriptor
        xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
        entityID="${this.config.entityId}">
        <md:SPSSODescriptor
          AuthnRequestsSigned="${this.config.wantMessagesSigned}"
          WantAssertionsSigned="${this.config.wantAssertionsSigned}"
          protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
          <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
          <md:AssertionConsumerService
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${this.config.entityId}/acs"
            index="0"/>
          ${this.config.sloUrl ? `
          <md:SingleLogoutService
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${this.config.sloUrl}"/>
          ` : ''}
        </md:SPSSODescriptor>
      </md:EntityDescriptor>
    `.trim();
  }
}

// =============================================================================
// OIDC CLIENT
// =============================================================================

export class OIDCClient {
  private config: OIDCConfig;
  private organizationId: string;
  private jwksCache: Map<string, any> = new Map();

  constructor(organizationId: string, config: OIDCConfig) {
    this.organizationId = organizationId;
    this.config = config;
  }

  /**
   * Generate authorization URL
   */
  generateAuthorizationUrl(redirectUri: string, state: string, nonce: string): string {
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', this.config.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    return url.toString();
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, redirectUri: string): Promise<{
    accessToken: string;
    idToken: string;
    refreshToken?: string;
    expiresIn: number;
  }> {
    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Validate ID token
   */
  async validateIdToken(idToken: string, nonce: string): Promise<{
    valid: boolean;
    claims?: Record<string, any>;
    error?: string;
  }> {
    try {
      // Decode header to get key ID
      const parts = idToken.split('.');
      const headerB64 = parts[0];
      if (!headerB64) {
        return { valid: false, error: 'Invalid token format' };
      }
      const header = JSON.parse(Buffer.from(headerB64, 'base64').toString());

      // Fetch JWKS if not cached
      if (!this.jwksCache.has(header.kid)) {
        const jwksResponse = await fetch(this.config.jwksUrl);
        const jwks = await jwksResponse.json();
        for (const key of jwks.keys) {
          this.jwksCache.set(key.kid, key);
        }
      }

      const jwk = this.jwksCache.get(header.kid);
      if (!jwk) {
        return { valid: false, error: 'Unknown key ID' };
      }

      // Verify token (simplified - use jose library in production)
      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded) {
        return { valid: false, error: 'Invalid token format' };
      }

      const payload = decoded.payload as jwt.JwtPayload;

      // Verify claims
      if (payload.iss !== this.config.issuer) {
        return { valid: false, error: 'Invalid issuer' };
      }
      if (payload.aud !== this.config.clientId) {
        return { valid: false, error: 'Invalid audience' };
      }
      if (payload.nonce !== nonce) {
        return { valid: false, error: 'Invalid nonce' };
      }
      if (payload.exp && payload.exp < Date.now() / 1000) {
        return { valid: false, error: 'Token expired' };
      }

      return { valid: true, claims: payload };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Get user info from userinfo endpoint
   */
  async getUserInfo(accessToken: string): Promise<Record<string, any>> {
    const response = await fetch(this.config.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`UserInfo request failed: ${response.statusText}`);
    }

    return response.json();
  }
}

// =============================================================================
// SCIM 2.0 PROVIDER
// =============================================================================

export class SCIMProvider {
  private prisma = prisma;
  private organizationId: string;
  private baseUrl: string;

  constructor(organizationId: string, baseUrl: string) {
    this.organizationId = organizationId;
    this.baseUrl = baseUrl;
  }

  // =============================================================================
  // USER OPERATIONS
  // =============================================================================

  /**
   * Create a SCIM user
   */
  async createUser(scimUser: SCIMUser): Promise<SCIMUser> {
    const email = scimUser.emails?.find(e => e.primary)?.value ?? scimUser.userName;
    
    const user = await this.prisma.user.create({
      data: {
        organizationId: this.organizationId,
        email,
        name: scimUser.name?.formatted ?? 
              `${scimUser.name?.givenName ?? ''} ${scimUser.name?.familyName ?? ''}`.trim() ??
              scimUser.userName,
        ssoSubject: scimUser.ssoSubject,
        role: 'READONLY',
        status: scimUser.active !== false ? 'ACTIVE' : 'DEACTIVATED',
      },
    });

    return this.userToSCIM(user);
  }

  /**
   * Get a SCIM user by ID
   */
  async getUser(userId: string): Promise<SCIMUser | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: this.organizationId,
      },
    });

    return user ? this.userToSCIM(user) : null;
  }

  /**
   * List SCIM users with filtering and pagination
   */
  async listUsers(params: {
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<{
    schemas: string[];
    totalResults: number;
    startIndex: number;
    itemsPerPage: number;
    Resources: SCIMUser[];
  }> {
    const startIndex = params.startIndex ?? 1;
    const count = Math.min(params.count ?? 100, 1000);

    // Parse SCIM filter (simplified)
    const where: Prisma.UserWhereInput = {
      organizationId: this.organizationId,
    };

    if (params.filter) {
      // Handle common filters like: userName eq "john@example.com"
      const emailMatch = params.filter.match(/userName\s+eq\s+"([^"]+)"/i);
      if (emailMatch) {
        where.email = emailMatch[1];
      }
      const ssoSubjectMatch = params.filter.match(/externalId\s+eq\s+"([^"]+)"/i);
      if (ssoSubjectMatch) {
        where.ssoSubject = ssoSubjectMatch[1];
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: startIndex - 1,
        take: count,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map(u => this.userToSCIM(u)),
    };
  }

  /**
   * Update a SCIM user
   */
  async updateUser(userId: string, scimUser: SCIMUser): Promise<SCIMUser | null> {
    const email = scimUser.emails?.find(e => e.primary)?.value ?? scimUser.userName;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email,
        name: scimUser.name?.formatted ?? 
              `${scimUser.name?.givenName ?? ''} ${scimUser.name?.familyName ?? ''}`.trim(),
        ssoSubject: scimUser.ssoSubject,
        status: scimUser.active !== false ? 'ACTIVE' : 'DEACTIVATED',
      },
    });

    return this.userToSCIM(user);
  }

  /**
   * Patch a SCIM user (partial update)
   */
  async patchUser(userId: string, operations: Array<{
    op: 'add' | 'remove' | 'replace';
    path?: string;
    value?: any;
  }>): Promise<SCIMUser | null> {
    const updates: Prisma.UserUpdateInput = {};

    for (const op of operations) {
      if (op.op === 'replace' || op.op === 'add') {
        if (op.path === 'active') {
          updates.status = op.value ? 'ACTIVE' : 'DEACTIVATED';
        } else if (op.path === 'name.givenName' || op.path === 'name.familyName') {
          // Would need to fetch current user and merge
        } else if (op.path === 'emails[type eq "work"].value') {
          updates.email = op.value;
        }
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    return this.userToSCIM(user);
  }

  /**
   * Delete a SCIM user
   */
  async deleteUser(userId: string): Promise<boolean> {
    try {
      await this.prisma.user.delete({
        where: { id: userId },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert internal user to SCIM format
   */
  private userToSCIM(user: User): SCIMUser {
    const nameParts = user.name.split(' ');
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      ssoSubject: user.ssoSubject ?? undefined,
      userName: user.email,
      name: {
        givenName: nameParts[0],
        familyName: nameParts.slice(1).join(' ') || undefined,
        formatted: user.name,
      },
      emails: [
        {
          value: user.email,
          type: 'work',
          primary: true,
        },
      ],
      active: user.status === 'ACTIVE',
      meta: {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
        location: `${this.baseUrl}/scim/v2/Users/${user.id}`,
      },
    };
  }

  // =============================================================================
  // GROUP OPERATIONS
  // =============================================================================

  /**
   * Create a SCIM group (maps to roles)
   */
  async createGroup(scimGroup: SCIMGroup): Promise<SCIMGroup> {
    // Groups map to roles in our system
    // This is a simplified implementation
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: crypto.randomUUID(),
      displayName: scimGroup.displayName,
      members: [],
      meta: {
        resourceType: 'Group',
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        location: `${this.baseUrl}/scim/v2/Groups/${scimGroup.id}`,
      },
    };
  }

  /**
   * List SCIM groups
   */
  async listGroups(): Promise<{
    schemas: string[];
    totalResults: number;
    Resources: SCIMGroup[];
  }> {
    // Return available roles as groups
    const roles: UserRole[] = ['OWNER', 'ADMIN', 'POLICY_MANAGER', 'AGENT_OPERATOR', 'AUDITOR', 'READONLY'];
    
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: roles.length,
      Resources: roles.map(role => ({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: role,
        displayName: role,
        meta: {
          resourceType: 'Group',
          location: `${this.baseUrl}/scim/v2/Groups/${role}`,
        },
      })),
    };
  }
}

// =============================================================================
// RBAC SERVICE
// =============================================================================

export class RBACService {
  private prisma = prisma;

  /**
   * Check if a user has a specific permission
   */
  hasPermission(role: UserRole, permission: Permission): boolean {
    return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
  }

  /**
   * Get all permissions for a role
   */
  getPermissions(role: UserRole): Permission[] {
    return PERMISSION_MATRIX[role] ?? [];
  }

  /**
   * Check if a user can perform an action
   */
  async canPerform(userId: string, permission: Permission): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) return false;
    return this.hasPermission(user.role as UserRole, permission);
  }

  /**
   * Get effective permissions for a user (including any custom overrides)
   */
  async getEffectivePermissions(userId: string): Promise<Permission[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) return [];
    return this.getPermissions(user.role as UserRole);
  }

  /**
   * Enforce permission (throws if not allowed)
   */
  async enforce(userId: string, permission: Permission): Promise<void> {
    const allowed = await this.canPerform(userId, permission);
    if (!allowed) {
      throw new Error(`Permission denied: ${permission}`);
    }
  }

  /**
   * Get users with a specific permission
   */
  async getUsersWithPermission(organizationId: string, permission: Permission): Promise<User[]> {
    const rolesWithPermission = (Object.entries(PERMISSION_MATRIX) as [UserRole, Permission[]][])
      .filter(([_, perms]) => perms.includes(permission))
      .map(([role]) => role);

    return this.prisma.user.findMany({
      where: {
        organizationId,
        role: { in: rolesWithPermission },
        status: 'ACTIVE',
      },
    });
  }
}

// =============================================================================
// SSO ACCESS CONTROL SERVICE
// =============================================================================

export class SSOAccessControlService {
  private prisma = prisma;
  private rbac: RBACService;
  private jwtSecret: string;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
    this.rbac = new RBACService();
  }

  /**
   * Get SAML provider for an organization
   */
  async getSAMLProvider(organizationId: string): Promise<SAMLServiceProvider | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org?.settings) return null;

    const settings = org.settings as any;
    const config = settings.sso;
    if (!config || config.type !== 'saml') return null;

    return new SAMLServiceProvider(organizationId, {
      entityId: config.entityId,
      ssoUrl: config.ssoUrl,
      sloUrl: config.sloUrl,
      certificate: config.certificate,
      signatureAlgorithm: config.signatureAlgorithm ?? 'sha256',
      digestAlgorithm: config.digestAlgorithm ?? 'sha256',
      wantAssertionsSigned: config.wantAssertionsSigned ?? true,
      wantMessagesSigned: config.wantMessagesSigned ?? true,
      attributeMapping: config.attributeMapping ?? { email: 'email' },
    });
  }

  /**
   * Get OIDC client for an organization
   */
  async getOIDCClient(organizationId: string): Promise<OIDCClient | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org?.settings) return null;

    const settings = org.settings as any;
    const config = settings.sso;
    if (!config || config.type !== 'oidc') return null;

    return new OIDCClient(organizationId, {
      issuer: config.issuer,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationUrl: config.authorizationUrl,
      tokenUrl: config.tokenUrl,
      userInfoUrl: config.userInfoUrl,
      jwksUrl: config.jwksUrl,
      scopes: config.scopes ?? ['openid', 'profile', 'email'],
      claimMapping: config.claimMapping ?? { email: 'email' },
    });
  }

  /**
   * Get SCIM provider for an organization
   */
  getSCIMProvider(organizationId: string, baseUrl: string): SCIMProvider {
    return new SCIMProvider(organizationId, baseUrl);
  }

  /**
   * Authenticate via SSO and create/update user
   */
  async authenticateSSO(
    organizationId: string,
    email: string,
    name: string,
    externalId?: string
  ): Promise<AuthResult> {
    try {
      // Find or create user
      let user = await this.prisma.user.findFirst({
        where: {
          organizationId,
          OR: [
            { email },
            { ssoSubject: externalId ?? undefined },
          ],
        },
      });

      if (!user) {
        // Create new user with default role
        user = await this.prisma.user.create({
          data: {
            organizationId,
            email,
            name,
            ssoSubject: externalId,
            role: 'READONLY',
            status: 'ACTIVE',
          },
        });
      } else {
        // Update existing user
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            email,
            name,
            ssoSubject: externalId,
            lastLoginAt: new Date(),
          },
        });
      }

      // Generate JWT
      const token = jwt.sign(
        {
          sub: user.id,
          email: user.email,
          org: organizationId,
          role: user.role,
        },
        this.jwtSecret,
        { expiresIn: '8h' }
      );

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId,
          role: user.role as UserRole,
          permissions: this.rbac.getPermissions(user.role as UserRole),
        },
        token,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate JWT token
   */
  async validateToken(token: string): Promise<AuthResult> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload;
      
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.sub as string },
      });

      if (!user || user.status !== 'ACTIVE') {
        return { success: false, error: 'User not found or inactive' };
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          role: user.role as UserRole,
          permissions: this.rbac.getPermissions(user.role as UserRole),
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get RBAC service
   */
  getRBAC(): RBACService {
    return this.rbac;
  }
}

/**
 * Create SSO Access Control Service
 */
export function createSSOAccessControlService(jwtSecret: string): SSOAccessControlService {
  return new SSOAccessControlService(jwtSecret);
}
