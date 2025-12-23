/**
 * Guthwine - Database Client
 * Prisma client singleton with connection management
 */

import { PrismaClient, Prisma } from '@prisma/client';

// Create Prisma client singleton
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
    errorFormat: 'pretty',
  });
};

// Type for client
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

// Global singleton
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

// Export singleton instance
export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Re-export Prisma namespace for types
export { Prisma };

// Export types
export type {
  Organization,
  User,
  Agent,
  Policy,
  DelegationToken,
  TransactionRequest,
  AuditLog,
  APIKey,
} from '@prisma/client';

/**
 * Connect to database
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  console.log('Database connected');
}

/**
 * Disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('Database disconnected');
}

/**
 * Check database health
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a transaction
 */
export async function runTransaction<T>(
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
): Promise<T> {
  return prisma.$transaction(fn, options);
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  organizations: number;
  users: number;
  agents: number;
  transactions: number;
  delegations: number;
  auditLogs: number;
}> {
  const [organizations, users, agents, transactions, delegations, auditLogs] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.agent.count(),
    prisma.transactionRequest.count(),
    prisma.delegationToken.count(),
    prisma.auditLog.count(),
  ]);

  return {
    organizations,
    users,
    agents,
    transactions,
    delegations,
    auditLogs,
  };
}
