/**
 * Guthwine - Policy Engine
 * JSON Logic based policy evaluation
 */

import jsonLogic from 'json-logic-js';
import { prisma } from '@guthwine/database';

export interface PolicyContext {
  amount: number;
  currency: string;
  merchantId: string;
  merchantCategory?: string;
  timestamp: Date;
  hour?: number;
  dayOfWeek?: number;
}

export interface PolicyResult {
  allowed: boolean;
  denied: boolean;
  flagged: boolean;
  reason?: string;
  violations: string[];
  matchedPolicies: string[];
  riskScore: number;
}

export class PolicyEngine {
  /**
   * Evaluate policies for an agent
   */
  async evaluatePolicies(
    agentId: string,
    organizationId: string,
    context: PolicyContext
  ): Promise<PolicyResult> {
    // Get policies assigned to this agent
    const assignments = await prisma.policyAssignment.findMany({
      where: { agentId },
      include: { policy: true },
      orderBy: { policy: { priority: 'desc' } },
    });

    const result: PolicyResult = {
      allowed: true,
      denied: false,
      flagged: false,
      violations: [],
      matchedPolicies: [],
      riskScore: 0,
    };

    // Enrich context with time data
    const enrichedContext = {
      ...context,
      hour: context.timestamp.getHours(),
      dayOfWeek: context.timestamp.getDay(),
    };

    // Evaluate each policy
    for (const assignment of assignments) {
      const policy = assignment.policy;
      if (!policy.isActive) continue;

      try {
        const rules = policy.rules as Record<string, unknown>;
        const matches = jsonLogic.apply(rules, enrichedContext);

        if (matches) {
          result.matchedPolicies.push(policy.id);

          // Check policy action
          const action = assignment.overrideAction || policy.action;
          
          if (action === 'DENY') {
            result.denied = true;
            result.allowed = false;
            result.reason = policy.name;
            result.violations.push(policy.name);
          } else if (action === 'FLAG') {
            result.flagged = true;
            result.riskScore += 20;
          }
        }
      } catch (error) {
        console.error(`Error evaluating policy ${policy.id}:`, error);
      }
    }

    return result;
  }

  /**
   * Create common policy templates
   */
  static POLICY_TEMPLATES = {
    maxAmount: (max: number) => ({
      '>': [{ var: 'amount' }, max],
    }),

    allowedCurrencies: (currencies: string[]) => ({
      '!': { in: [{ var: 'currency' }, currencies] },
    }),

    blockedMerchants: (merchants: string[]) => ({
      in: [{ var: 'merchantId' }, merchants],
    }),

    businessHoursOnly: () => ({
      or: [
        { '<': [{ var: 'hour' }, 9] },
        { '>': [{ var: 'hour' }, 17] },
        { '<': [{ var: 'dayOfWeek' }, 1] },
        { '>': [{ var: 'dayOfWeek' }, 5] },
      ],
    }),

    allowedCategories: (categories: string[]) => ({
      '!': { in: [{ var: 'merchantCategory' }, categories] },
    }),
  };
}

export const policyEngine = new PolicyEngine();
