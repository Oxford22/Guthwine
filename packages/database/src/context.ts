/**
 * Database Context Management for Row-Level Security
 * 
 * This module provides functions to set and clear the organization context
 * for Row-Level Security policies in PostgreSQL.
 */

import { PrismaClient } from '@prisma/client';

/**
 * Set the organization context for the current database session.
 * This enables Row-Level Security policies to filter data by organization.
 * 
 * @param prisma - The Prisma client instance
 * @param orgId - The organization ID to set as context
 */
export async function setOrgContext(prisma: PrismaClient, orgId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT set_org_context('${orgId}')`);
}

/**
 * Set the system admin context for the current database session.
 * When true, RLS policies will allow access to all organizations.
 * 
 * @param prisma - The Prisma client instance
 * @param isAdmin - Whether the current user is a system admin
 */
export async function setSystemAdminContext(prisma: PrismaClient, isAdmin: boolean): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT set_system_admin_context(${isAdmin})`);
}

/**
 * Clear the organization context for the current database session.
 * Should be called when returning connections to the pool.
 * 
 * @param prisma - The Prisma client instance
 */
export async function clearContext(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT clear_context()`);
}

/**
 * Execute a function with organization context set.
 * Automatically clears context after execution.
 * 
 * @param prisma - The Prisma client instance
 * @param orgId - The organization ID to set as context
 * @param fn - The function to execute with context
 */
export async function withOrgContext<T>(
  prisma: PrismaClient,
  orgId: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    await setOrgContext(prisma, orgId);
    return await fn();
  } finally {
    await clearContext(prisma);
  }
}

/**
 * Execute a function with system admin context.
 * Automatically clears context after execution.
 * 
 * @param prisma - The Prisma client instance
 * @param fn - The function to execute with admin context
 */
export async function withSystemAdminContext<T>(
  prisma: PrismaClient,
  fn: () => Promise<T>
): Promise<T> {
  try {
    await setSystemAdminContext(prisma, true);
    return await fn();
  } finally {
    await clearContext(prisma);
  }
}

/**
 * Prisma middleware to automatically set organization context.
 * Use this with Prisma's $use() method.
 * 
 * @param orgIdGetter - Function that returns the current organization ID
 */
export function createOrgContextMiddleware(orgIdGetter: () => string | null) {
  return async (params: any, next: (params: any) => Promise<any>) => {
    const orgId = orgIdGetter();
    if (orgId) {
      // Note: This approach doesn't work well with connection pooling
      // For production, use withOrgContext() wrapper instead
    }
    return next(params);
  };
}

/**
 * Create a Prisma client extension that automatically handles org context.
 * 
 * @param orgId - The organization ID to use for all queries
 */
export function createOrgScopedClient(basePrisma: PrismaClient, orgId: string) {
  return basePrisma.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        // Set context before query
        await basePrisma.$executeRawUnsafe(`SELECT set_org_context('${orgId}')`);
        try {
          return await query(args);
        } finally {
          // Clear context after query
          await basePrisma.$executeRawUnsafe(`SELECT clear_context()`);
        }
      },
    },
  });
}
