/**
 * Guthwine - Custom Error Classes
 * Structured errors for better error handling
 */

// Base error class
export class GuthwineError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GuthwineError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

// Authentication errors
export class AuthenticationError extends GuthwineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid credentials', details);
    this.name = 'InvalidCredentialsError';
  }
}

export class TokenExpiredError extends AuthenticationError {
  constructor(details?: Record<string, unknown>) {
    super('Token has expired', details);
    this.name = 'TokenExpiredError';
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor(details?: Record<string, unknown>) {
    super('Invalid token', details);
    this.name = 'InvalidTokenError';
  }
}

// Authorization errors
export class AuthorizationError extends GuthwineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTHORIZATION_ERROR', 403, details);
    this.name = 'AuthorizationError';
  }
}

export class InsufficientPermissionsError extends AuthorizationError {
  constructor(requiredPermission: string, details?: Record<string, unknown>) {
    super(`Insufficient permissions: ${requiredPermission} required`, {
      ...details,
      requiredPermission,
    });
    this.name = 'InsufficientPermissionsError';
  }
}

export class AgentFrozenError extends AuthorizationError {
  constructor(agentDid: string, details?: Record<string, unknown>) {
    super(`Agent ${agentDid} is frozen`, { ...details, agentDid });
    this.name = 'AgentFrozenError';
  }
}

export class GlobalFreezeError extends AuthorizationError {
  constructor(details?: Record<string, unknown>) {
    super('System is in global freeze mode', details);
    this.name = 'GlobalFreezeError';
  }
}

// Validation errors
export class ValidationError extends GuthwineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class InvalidInputError extends ValidationError {
  constructor(field: string, reason: string, details?: Record<string, unknown>) {
    super(`Invalid input for ${field}: ${reason}`, { ...details, field, reason });
    this.name = 'InvalidInputError';
  }
}

export class InvalidDIDError extends ValidationError {
  constructor(did: string, details?: Record<string, unknown>) {
    super(`Invalid DID format: ${did}`, { ...details, did });
    this.name = 'InvalidDIDError';
  }
}

// Not found errors
export class NotFoundError extends GuthwineError {
  constructor(resource: string, identifier: string, details?: Record<string, unknown>) {
    super(`${resource} not found: ${identifier}`, 'NOT_FOUND', 404, {
      ...details,
      resource,
      identifier,
    });
    this.name = 'NotFoundError';
  }
}

export class AgentNotFoundError extends NotFoundError {
  constructor(identifier: string, details?: Record<string, unknown>) {
    super('Agent', identifier, details);
    this.name = 'AgentNotFoundError';
  }
}

export class OrganizationNotFoundError extends NotFoundError {
  constructor(identifier: string, details?: Record<string, unknown>) {
    super('Organization', identifier, details);
    this.name = 'OrganizationNotFoundError';
  }
}

export class PolicyNotFoundError extends NotFoundError {
  constructor(identifier: string, details?: Record<string, unknown>) {
    super('Policy', identifier, details);
    this.name = 'PolicyNotFoundError';
  }
}

export class DelegationNotFoundError extends NotFoundError {
  constructor(identifier: string, details?: Record<string, unknown>) {
    super('Delegation', identifier, details);
    this.name = 'DelegationNotFoundError';
  }
}

export class TransactionNotFoundError extends NotFoundError {
  constructor(identifier: string, details?: Record<string, unknown>) {
    super('Transaction', identifier, details);
    this.name = 'TransactionNotFoundError';
  }
}

// Conflict errors
export class ConflictError extends GuthwineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

export class DuplicateError extends ConflictError {
  constructor(resource: string, field: string, value: string, details?: Record<string, unknown>) {
    super(`${resource} with ${field} "${value}" already exists`, {
      ...details,
      resource,
      field,
      value,
    });
    this.name = 'DuplicateError';
  }
}

// Policy errors
export class PolicyViolationError extends GuthwineError {
  constructor(
    violations: string[],
    policyId?: string,
    details?: Record<string, unknown>
  ) {
    super(`Policy violation: ${violations.join(', ')}`, 'POLICY_VIOLATION', 403, {
      ...details,
      violations,
      policyId,
    });
    this.name = 'PolicyViolationError';
  }
}

// Delegation errors
export class DelegationError extends GuthwineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DELEGATION_ERROR', 400, details);
    this.name = 'DelegationError';
  }
}

export class DelegationChainError extends DelegationError {
  constructor(message: string, chainDepth: number, details?: Record<string, unknown>) {
    super(message, { ...details, chainDepth });
    this.name = 'DelegationChainError';
  }
}

export class DelegationExpiredError extends DelegationError {
  constructor(tokenId: string, details?: Record<string, unknown>) {
    super(`Delegation token ${tokenId} has expired`, { ...details, tokenId });
    this.name = 'DelegationExpiredError';
  }
}

export class DelegationRevokedError extends DelegationError {
  constructor(tokenId: string, details?: Record<string, unknown>) {
    super(`Delegation token ${tokenId} has been revoked`, { ...details, tokenId });
    this.name = 'DelegationRevokedError';
  }
}

export class ConstraintEscalationError extends DelegationError {
  constructor(constraint: string, details?: Record<string, unknown>) {
    super(`Cannot exceed parent constraint: ${constraint}`, { ...details, constraint });
    this.name = 'ConstraintEscalationError';
  }
}

// Rate limiting errors
export class RateLimitError extends GuthwineError {
  constructor(
    limitType: string,
    limit: number,
    windowMs: number,
    details?: Record<string, unknown>
  ) {
    super(`Rate limit exceeded: ${limitType}`, 'RATE_LIMIT_EXCEEDED', 429, {
      ...details,
      limitType,
      limit,
      windowMs,
      retryAfterMs: windowMs,
    });
    this.name = 'RateLimitError';
  }
}

// External service errors
export class ExternalServiceError extends GuthwineError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`External service error (${service}): ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, {
      ...details,
      service,
    });
    this.name = 'ExternalServiceError';
  }
}

export class PaymentRailError extends ExternalServiceError {
  constructor(rail: string, message: string, details?: Record<string, unknown>) {
    super(rail, message, details);
    this.name = 'PaymentRailError';
  }
}

export class LLMProviderError extends ExternalServiceError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(provider, message, details);
    this.name = 'LLMProviderError';
  }
}

// Audit errors
export class AuditIntegrityError extends GuthwineError {
  constructor(
    sequenceNumber: number,
    expectedHash: string,
    actualHash: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Audit chain integrity violation at sequence ${sequenceNumber}`,
      'AUDIT_INTEGRITY_ERROR',
      500,
      { ...details, sequenceNumber, expectedHash, actualHash }
    );
    this.name = 'AuditIntegrityError';
  }
}

// Error factory for creating errors from codes
export function createError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): GuthwineError {
  switch (code) {
    case 'AUTHENTICATION_ERROR':
      return new AuthenticationError(message, details);
    case 'AUTHORIZATION_ERROR':
      return new AuthorizationError(message, details);
    case 'VALIDATION_ERROR':
      return new ValidationError(message, details);
    case 'NOT_FOUND':
      return new NotFoundError('Resource', message);
    case 'CONFLICT':
      return new ConflictError(message, details);
    case 'DELEGATION_ERROR':
      return new DelegationError(message, details);
    default:
      return new GuthwineError(message, code, 500, details);
  }
}

// Type guard for GuthwineError
export function isGuthwineError(error: unknown): error is GuthwineError {
  return error instanceof GuthwineError;
}
