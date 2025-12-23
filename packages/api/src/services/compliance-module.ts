/**
 * Compliance Module
 * 
 * Features:
 * - AI Act impact assessment
 * - Human oversight workflow
 * - Audit export (JSON, CSV, PDF)
 * - Data retention policies
 */

import { prisma, Prisma } from '@guthwine/database';
import * as crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export type RiskCategory = 'UNACCEPTABLE' | 'HIGH' | 'LIMITED' | 'MINIMAL';
export type HumanOversightStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'EXPIRED';
export type AuditExportFormat = 'json' | 'csv' | 'pdf';

export interface AIActAssessment {
  id: string;
  organizationId: string;
  agentId: string;
  assessmentDate: Date;
  riskCategory: RiskCategory;
  riskScore: number; // 0-100
  factors: RiskFactor[];
  mitigations: Mitigation[];
  recommendations: string[];
  complianceStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'NEEDS_REVIEW';
  nextReviewDate: Date;
}

export interface RiskFactor {
  category: string;
  name: string;
  description: string;
  weight: number;
  score: number;
  evidence: string[];
}

export interface Mitigation {
  factorId: string;
  description: string;
  status: 'IMPLEMENTED' | 'PLANNED' | 'NOT_APPLICABLE';
  implementedAt?: Date;
  verifiedBy?: string;
}

export interface HumanOversightRequest {
  id: string;
  organizationId: string;
  transactionId: string;
  agentId: string;
  requestedAt: Date;
  reason: string;
  riskScore: number;
  context: Record<string, any>;
  status: HumanOversightStatus;
  assignedTo?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  decision?: string;
  notes?: string;
  escalationLevel: number;
  expiresAt: Date;
}

export interface AuditExportOptions {
  organizationId: string;
  format: AuditExportFormat;
  startDate: Date;
  endDate: Date;
  agentIds?: string[];
  actions?: string[];
  includeMetadata?: boolean;
  anonymize?: boolean;
}

export interface DataRetentionPolicy {
  id: string;
  organizationId: string;
  resourceType: string;
  retentionDays: number;
  archiveAfterDays?: number;
  deleteAfterDays?: number;
  legalHold: boolean;
  lastExecuted?: Date;
  nextExecution?: Date;
}

// =============================================================================
// AI ACT RISK ASSESSMENT
// =============================================================================

export class AIActAssessmentService {
  private prisma = prisma;

  // Risk factors based on EU AI Act categories
  private readonly RISK_FACTORS: Array<{
    category: string;
    name: string;
    description: string;
    weight: number;
    evaluator: (context: any) => number;
  }> = [
    {
      category: 'AUTONOMY',
      name: 'Decision Autonomy Level',
      description: 'Degree of autonomous decision-making without human oversight',
      weight: 0.15,
      evaluator: (ctx) => {
        if (ctx.requiresApproval) return 20;
        if (ctx.hasHumanOversight) return 40;
        return 80;
      },
    },
    {
      category: 'IMPACT',
      name: 'Financial Impact',
      description: 'Potential financial impact of decisions',
      weight: 0.20,
      evaluator: (ctx) => {
        const maxAmount = ctx.spendingLimit ?? 0;
        if (maxAmount < 100) return 10;
        if (maxAmount < 1000) return 30;
        if (maxAmount < 10000) return 50;
        if (maxAmount < 100000) return 70;
        return 90;
      },
    },
    {
      category: 'SCOPE',
      name: 'Affected Users',
      description: 'Number of users potentially affected by agent actions',
      weight: 0.15,
      evaluator: (ctx) => {
        const users = ctx.affectedUsers ?? 1;
        if (users < 10) return 10;
        if (users < 100) return 30;
        if (users < 1000) return 50;
        if (users < 10000) return 70;
        return 90;
      },
    },
    {
      category: 'DATA',
      name: 'Data Sensitivity',
      description: 'Sensitivity of data accessed by the agent',
      weight: 0.15,
      evaluator: (ctx) => {
        if (ctx.accessesPII) return 70;
        if (ctx.accessesFinancial) return 60;
        if (ctx.accessesConfidential) return 50;
        return 20;
      },
    },
    {
      category: 'REVERSIBILITY',
      name: 'Action Reversibility',
      description: 'Ability to reverse or undo agent actions',
      weight: 0.10,
      evaluator: (ctx) => {
        if (ctx.actionsReversible) return 20;
        if (ctx.hasUndoCapability) return 40;
        return 80;
      },
    },
    {
      category: 'TRANSPARENCY',
      name: 'Decision Explainability',
      description: 'Ability to explain agent decisions',
      weight: 0.10,
      evaluator: (ctx) => {
        if (ctx.providesExplanations) return 20;
        if (ctx.logsDecisions) return 40;
        return 70;
      },
    },
    {
      category: 'SAFETY',
      name: 'Safety Controls',
      description: 'Presence of safety controls and kill switches',
      weight: 0.15,
      evaluator: (ctx) => {
        let score = 100;
        if (ctx.hasKillSwitch) score -= 30;
        if (ctx.hasRateLimits) score -= 20;
        if (ctx.hasAnomalyDetection) score -= 20;
        if (ctx.hasPolicyEngine) score -= 20;
        return Math.max(10, score);
      },
    },
  ];

  /**
   * Perform AI Act risk assessment for an agent
   */
  async assessAgent(
    organizationId: string,
    agentId: string,
    context: Record<string, any>
  ): Promise<AIActAssessment> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        policyAssignments: { include: { policy: true } },
      },
    });

    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Enrich context with agent data
    const enrichedContext = {
      ...context,
      hasKillSwitch: true, // Guthwine provides this
      hasRateLimits: true,
      hasPolicyEngine: true,
      hasAnomalyDetection: true,
      logsDecisions: true,
      spendingLimit: (agent.spendingLimits as any)?.daily ?? 0,
    };

    // Evaluate each risk factor
    const factors: RiskFactor[] = this.RISK_FACTORS.map(factor => ({
      category: factor.category,
      name: factor.name,
      description: factor.description,
      weight: factor.weight,
      score: factor.evaluator(enrichedContext),
      evidence: this.gatherEvidence(factor.category, enrichedContext),
    }));

    // Calculate overall risk score
    const riskScore = factors.reduce(
      (sum, f) => sum + f.score * f.weight,
      0
    );

    // Determine risk category
    const riskCategory = this.determineRiskCategory(riskScore, factors);

    // Generate mitigations
    const mitigations = this.generateMitigations(factors, enrichedContext);

    // Generate recommendations
    const recommendations = this.generateRecommendations(riskCategory, factors);

    // Determine compliance status
    const complianceStatus = this.determineComplianceStatus(riskCategory, mitigations);

    const assessment: AIActAssessment = {
      id: crypto.randomUUID(),
      organizationId,
      agentId,
      assessmentDate: new Date(),
      riskCategory,
      riskScore: Math.round(riskScore),
      factors,
      mitigations,
      recommendations,
      complianceStatus,
      nextReviewDate: this.calculateNextReviewDate(riskCategory),
    };

    // Store assessment as compliance report
    const now = new Date();
    await this.prisma.complianceReport.create({
      data: {
        organizationId,
        type: 'IMPACT_ASSESSMENT',
        startTime: now,
        endTime: now,
        summary: { riskCategory, riskScore: assessment.riskScore, complianceStatus } as Prisma.InputJsonValue,
        details: assessment as unknown as Prisma.InputJsonValue,
        generatedAt: now,
        generatedById: 'system',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    return assessment;
  }

  private gatherEvidence(category: string, context: any): string[] {
    const evidence: string[] = [];
    
    switch (category) {
      case 'AUTONOMY':
        if (context.requiresApproval) evidence.push('Human approval required for actions');
        if (context.hasHumanOversight) evidence.push('Human oversight enabled');
        break;
      case 'IMPACT':
        evidence.push(`Spending limit: ${context.spendingLimit ?? 'unlimited'}`);
        break;
      case 'SAFETY':
        if (context.hasKillSwitch) evidence.push('Kill switch available');
        if (context.hasRateLimits) evidence.push('Rate limiting enabled');
        if (context.hasPolicyEngine) evidence.push('Policy engine active');
        break;
    }
    
    return evidence;
  }

  private determineRiskCategory(score: number, factors: RiskFactor[]): RiskCategory {
    // Check for unacceptable risk factors
    const hasUnacceptable = factors.some(
      f => f.category === 'AUTONOMY' && f.score > 90 ||
           f.category === 'IMPACT' && f.score > 95
    );
    if (hasUnacceptable) return 'UNACCEPTABLE';

    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'LIMITED';
    return 'MINIMAL';
  }

  private generateMitigations(factors: RiskFactor[], context: any): Mitigation[] {
    const mitigations: Mitigation[] = [];

    for (const factor of factors) {
      if (factor.score > 50) {
        mitigations.push({
          factorId: factor.category,
          description: this.getMitigationDescription(factor.category),
          status: this.getMitigationStatus(factor.category, context),
          implementedAt: context[`${factor.category.toLowerCase()}MitigatedAt`],
        });
      }
    }

    return mitigations;
  }

  private getMitigationDescription(category: string): string {
    const descriptions: Record<string, string> = {
      AUTONOMY: 'Implement human-in-the-loop approval for high-value decisions',
      IMPACT: 'Set appropriate spending limits and transaction caps',
      SCOPE: 'Limit agent scope to specific user groups or departments',
      DATA: 'Implement data minimization and access controls',
      REVERSIBILITY: 'Add undo capability and transaction rollback',
      TRANSPARENCY: 'Enable decision logging and explanation generation',
      SAFETY: 'Activate all safety controls including kill switch',
    };
    return descriptions[category] ?? 'Review and mitigate risk factor';
  }

  private getMitigationStatus(category: string, context: any): Mitigation['status'] {
    const implemented: Record<string, boolean> = {
      AUTONOMY: context.hasHumanOversight,
      SAFETY: context.hasKillSwitch && context.hasRateLimits,
      TRANSPARENCY: context.logsDecisions,
    };
    return implemented[category] ? 'IMPLEMENTED' : 'PLANNED';
  }

  private generateRecommendations(category: RiskCategory, factors: RiskFactor[]): string[] {
    const recommendations: string[] = [];

    if (category === 'UNACCEPTABLE') {
      recommendations.push('CRITICAL: Agent use case may be prohibited under AI Act');
      recommendations.push('Consult legal counsel before deployment');
    }

    if (category === 'HIGH') {
      recommendations.push('Register system in EU AI database before deployment');
      recommendations.push('Implement conformity assessment procedures');
      recommendations.push('Establish post-market monitoring system');
    }

    // Factor-specific recommendations
    for (const factor of factors.filter(f => f.score > 60)) {
      recommendations.push(`Address ${factor.name}: ${factor.description}`);
    }

    return recommendations;
  }

  private determineComplianceStatus(
    category: RiskCategory,
    mitigations: Mitigation[]
  ): AIActAssessment['complianceStatus'] {
    if (category === 'UNACCEPTABLE') return 'NON_COMPLIANT';
    
    const implementedCount = mitigations.filter(m => m.status === 'IMPLEMENTED').length;
    const totalRequired = mitigations.length;
    
    if (totalRequired === 0 || implementedCount === totalRequired) return 'COMPLIANT';
    if (implementedCount >= totalRequired * 0.7) return 'NEEDS_REVIEW';
    return 'NON_COMPLIANT';
  }

  private calculateNextReviewDate(category: RiskCategory): Date {
    const now = new Date();
    const daysUntilReview: Record<RiskCategory, number> = {
      UNACCEPTABLE: 7,
      HIGH: 30,
      LIMITED: 90,
      MINIMAL: 365,
    };
    return new Date(now.getTime() + daysUntilReview[category] * 24 * 60 * 60 * 1000);
  }
}

// =============================================================================
// HUMAN OVERSIGHT WORKFLOW
// =============================================================================

export class HumanOversightService {
  private prisma = prisma;
  private readonly ESCALATION_TIMEOUT_HOURS = 4;
  private readonly MAX_ESCALATION_LEVEL = 3;

  /**
   * Create a human oversight request
   */
  async createRequest(params: {
    organizationId: string;
    transactionId: string;
    agentId: string;
    reason: string;
    riskScore: number;
    context: Record<string, any>;
    assignTo?: string;
  }): Promise<HumanOversightRequest> {
    const expiresAt = new Date(
      Date.now() + this.ESCALATION_TIMEOUT_HOURS * 60 * 60 * 1000
    );

    const request: HumanOversightRequest = {
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      transactionId: params.transactionId,
      agentId: params.agentId,
      requestedAt: new Date(),
      reason: params.reason,
      riskScore: params.riskScore,
      context: params.context,
      status: 'PENDING',
      assignedTo: params.assignTo,
      escalationLevel: 0,
      expiresAt,
    };

    // Get next sequence number
    const lastLog = await this.prisma.auditLog.findFirst({
      where: { organizationId: params.organizationId },
      orderBy: { sequenceNumber: 'desc' },
    });
    const sequenceNumber = (lastLog?.sequenceNumber ?? 0) + 1;

    // Store in audit log
    const entryHash = crypto.createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');

    await this.prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        sequenceNumber,
        action: 'HUMAN_OVERSIGHT_REQUESTED',
        severity: 'WARNING',
        actorType: 'AGENT',
        actorId: params.agentId,
        targetType: 'TRANSACTION',
        targetId: params.transactionId,
        payload: request as unknown as Prisma.InputJsonValue,
        entryHash,
        previousHash: lastLog?.entryHash ?? '',
        signature: entryHash, // Simplified
        timestamp: new Date(),
        retainUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    return request;
  }

  /**
   * Review and decide on an oversight request
   */
  async reviewRequest(
    organizationId: string,
    requestId: string,
    reviewerId: string,
    decision: 'APPROVED' | 'REJECTED',
    notes?: string
  ): Promise<HumanOversightRequest> {
    const request: Partial<HumanOversightRequest> = {
      id: requestId,
      status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
      decision,
      notes,
    };

    // Get next sequence number
    const lastLog = await this.prisma.auditLog.findFirst({
      where: { organizationId },
      orderBy: { sequenceNumber: 'desc' },
    });
    const sequenceNumber = (lastLog?.sequenceNumber ?? 0) + 1;

    const entryHash = crypto.createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');

    // Log the decision
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        sequenceNumber,
        action: 'HUMAN_OVERSIGHT_DECISION',
        severity: 'INFO',
        actorType: 'USER',
        actorId: reviewerId,
        targetType: 'OVERSIGHT_REQUEST',
        targetId: requestId,
        payload: request as unknown as Prisma.InputJsonValue,
        entryHash,
        previousHash: lastLog?.entryHash ?? '',
        signature: entryHash,
        timestamp: new Date(),
        retainUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    return request as HumanOversightRequest;
  }

  /**
   * Escalate a pending request
   */
  async escalateRequest(
    organizationId: string,
    requestId: string,
    reason: string
  ): Promise<HumanOversightRequest> {
    const request: Partial<HumanOversightRequest> = {
      id: requestId,
      status: 'ESCALATED',
      escalationLevel: 1,
      notes: reason,
    };

    // Get next sequence number
    const lastLog = await this.prisma.auditLog.findFirst({
      where: { organizationId },
      orderBy: { sequenceNumber: 'desc' },
    });
    const sequenceNumber = (lastLog?.sequenceNumber ?? 0) + 1;

    const entryHash = crypto.createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        sequenceNumber,
        action: 'HUMAN_OVERSIGHT_ESCALATED',
        severity: 'WARNING',
        actorType: 'SYSTEM',
        targetType: 'OVERSIGHT_REQUEST',
        targetId: requestId,
        payload: request as unknown as Prisma.InputJsonValue,
        entryHash,
        previousHash: lastLog?.entryHash ?? '',
        signature: entryHash,
        timestamp: new Date(),
        retainUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    return request as HumanOversightRequest;
  }

  /**
   * Get pending requests for an organization
   */
  async getPendingRequests(organizationId: string): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: {
        organizationId,
        action: 'HUMAN_OVERSIGHT_REQUESTED',
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }
}

// =============================================================================
// AUDIT EXPORT SERVICE
// =============================================================================

export class AuditExportService {
  private prisma = prisma;

  /**
   * Export audit logs in specified format
   */
  async export(options: AuditExportOptions): Promise<{
    format: AuditExportFormat;
    data: string | Buffer;
    filename: string;
    recordCount: number;
  }> {
    // Fetch audit logs
    const logs = await this.prisma.auditLog.findMany({
      where: {
        organizationId: options.organizationId,
        timestamp: {
          gte: options.startDate,
          lte: options.endDate,
        },
        ...(options.agentIds?.length && { agentId: { in: options.agentIds } }),
        ...(options.actions?.length && { action: { in: options.actions } }),
      },
      orderBy: { timestamp: 'asc' },
    });

    // Optionally anonymize
    const processedLogs = options.anonymize
      ? logs.map(log => this.anonymizeLog(log))
      : logs;

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-export-${timestamp}.${options.format}`;

    // Export in requested format
    switch (options.format) {
      case 'json':
        return {
          format: 'json',
          data: JSON.stringify(processedLogs, null, 2),
          filename,
          recordCount: logs.length,
        };

      case 'csv':
        return {
          format: 'csv',
          data: this.toCSV(processedLogs),
          filename,
          recordCount: logs.length,
        };

      case 'pdf':
        return {
          format: 'pdf',
          data: await this.toPDF(processedLogs, options),
          filename,
          recordCount: logs.length,
        };

      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  private anonymizeLog(log: any): any {
    return {
      ...log,
      actorId: log.actorId ? this.hashId(log.actorId) : null,
      agentId: log.agentId ? this.hashId(log.agentId) : null,
      payload: this.anonymizePayload(log.payload),
    };
  }

  private hashId(id: string): string {
    return crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
  }

  private anonymizePayload(payload: any): any {
    if (!payload || typeof payload !== 'object') return payload;

    const sensitiveFields = ['email', 'name', 'ip', 'userAgent', 'password', 'secret'];
    const anonymized = { ...payload };

    for (const field of sensitiveFields) {
      if (field in anonymized) {
        anonymized[field] = '[REDACTED]';
      }
    }

    return anonymized;
  }

  private toCSV(logs: any[]): string {
    if (logs.length === 0) return '';

    const headers = ['id', 'organizationId', 'action', 'severity', 'actorType', 'actorId', 'timestamp', 'entryHash'];
    const rows = logs.map(log => [
      log.id,
      log.organizationId,
      log.action,
      log.severity,
      log.actorType,
      log.actorId ?? '',
      log.timestamp.toISOString(),
      log.entryHash,
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
  }

  private async toPDF(logs: any[], options: AuditExportOptions): Promise<Buffer> {
    // Generate a simple text-based PDF representation
    // In production, use a library like pdfkit or puppeteer
    
    const content = [
      'AUDIT LOG EXPORT',
      '================',
      '',
      `Organization: ${options.organizationId}`,
      `Period: ${options.startDate.toISOString()} to ${options.endDate.toISOString()}`,
      `Total Records: ${logs.length}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '---',
      '',
      ...logs.map(log => [
        `[${log.timestamp.toISOString()}] ${log.action}`,
        `  Actor: ${log.actorType} ${log.actorId ?? 'N/A'}`,
        `  Hash: ${log.entryHash}`,
        '',
      ].join('\n')),
    ].join('\n');

    // Return as buffer (would be actual PDF in production)
    return Buffer.from(content, 'utf-8');
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    organizationId: string,
    reportType: 'TRANSACTION_SUMMARY' | 'AGENT_ACTIVITY' | 'POLICY_VIOLATIONS' | 'DELEGATION_AUDIT' | 'FULL_AUDIT_EXPORT',
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Gather statistics
    const [totalLogs, actionCounts, agentActivity] = await Promise.all([
      this.prisma.auditLog.count({
        where: { organizationId, timestamp: { gte: startDate, lte: endDate } },
      }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { organizationId, timestamp: { gte: startDate, lte: endDate } },
        _count: true,
      }),
      this.prisma.auditLog.groupBy({
        by: ['agentId'],
        where: { organizationId, timestamp: { gte: startDate, lte: endDate }, agentId: { not: null } },
        _count: true,
      }),
    ]);

    const summary = {
      totalEvents: totalLogs,
      uniqueAgents: agentActivity.length,
      actionTypes: actionCounts.map(e => ({ action: e.action, count: e._count })),
    };

    const details = {
      agentActivity: agentActivity.map(a => ({ agentId: a.agentId, eventCount: a._count })),
    };

    return this.prisma.complianceReport.create({
      data: {
        organizationId,
        type: reportType,
        startTime: startDate,
        endTime: endDate,
        summary: summary as Prisma.InputJsonValue,
        details: details as Prisma.InputJsonValue,
        generatedAt: new Date(),
        generatedById: 'system',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
  }
}

// =============================================================================
// DATA RETENTION SERVICE
// =============================================================================

export class DataRetentionService {
  private prisma = prisma;

  /**
   * Create a data retention policy
   */
  async createPolicy(policy: Omit<DataRetentionPolicy, 'id'>): Promise<DataRetentionPolicy> {
    const id = crypto.randomUUID();
    const nextExecution = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow

    const fullPolicy: DataRetentionPolicy = {
      ...policy,
      id,
      nextExecution,
    };

    // Store in organization settings
    const org = await this.prisma.organization.findUnique({
      where: { id: policy.organizationId },
    });

    const settings = (org?.settings as any) ?? {};
    const policies = settings.retentionPolicies ?? [];
    policies.push(fullPolicy);

    await this.prisma.organization.update({
      where: { id: policy.organizationId },
      data: {
        settings: { ...settings, retentionPolicies: policies },
      },
    });

    return fullPolicy;
  }

  /**
   * Execute retention policy
   */
  async executePolicy(policy: DataRetentionPolicy): Promise<{
    deletedCount: number;
    archivedCount: number;
  }> {
    let deletedCount = 0;
    let archivedCount = 0;

    // Skip if legal hold is active
    if (policy.legalHold) {
      return { deletedCount: 0, archivedCount: 0 };
    }

    switch (policy.resourceType) {
      case 'audit_logs':
        // Archive old logs
        if (policy.archiveAfterDays) {
          const archiveCutoff = new Date(
            Date.now() - policy.archiveAfterDays * 24 * 60 * 60 * 1000
          );
          // In production, move to archive storage
          archivedCount = await this.prisma.auditLog.count({
            where: {
              organizationId: policy.organizationId,
              timestamp: { lt: archiveCutoff },
            },
          });
        }

        // Delete old logs
        if (policy.deleteAfterDays) {
          const deleteCutoff = new Date(
            Date.now() - policy.deleteAfterDays * 24 * 60 * 60 * 1000
          );
          const result = await this.prisma.auditLog.deleteMany({
            where: {
              organizationId: policy.organizationId,
              timestamp: { lt: deleteCutoff },
            },
          });
          deletedCount = result.count;
        }
        break;

      case 'transactions':
        if (policy.deleteAfterDays) {
          const deleteCutoff = new Date(
            Date.now() - policy.deleteAfterDays * 24 * 60 * 60 * 1000
          );
          const result = await this.prisma.transactionRequest.deleteMany({
            where: {
              organizationId: policy.organizationId,
              createdAt: { lt: deleteCutoff },
            },
          });
          deletedCount = result.count;
        }
        break;
    }

    return { deletedCount, archivedCount };
  }

  /**
   * Set legal hold on organization data
   */
  async setLegalHold(
    organizationId: string,
    enabled: boolean,
    reason?: string
  ): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    const settings = (org?.settings as any) ?? {};
    settings.legalHold = {
      enabled,
      reason,
      setAt: new Date(),
    };

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings },
    });

    // Get next sequence number
    const lastLog = await this.prisma.auditLog.findFirst({
      where: { organizationId },
      orderBy: { sequenceNumber: 'desc' },
    });
    const sequenceNumber = (lastLog?.sequenceNumber ?? 0) + 1;

    const entryHash = crypto.createHash('sha256')
      .update(`legal_hold:${organizationId}:${enabled}:${Date.now()}`)
      .digest('hex');

    // Log the action
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        sequenceNumber,
        action: enabled ? 'LEGAL_HOLD_ENABLED' : 'LEGAL_HOLD_DISABLED',
        severity: 'WARNING',
        actorType: 'SYSTEM',
        payload: { reason } as Prisma.InputJsonValue,
        entryHash,
        previousHash: lastLog?.entryHash ?? '',
        signature: entryHash,
        timestamp: new Date(),
        retainUntil: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000), // 10 years
      },
    });
  }

  /**
   * Get GDPR data export for a user
   */
  async exportUserData(
    organizationId: string,
    userId: string
  ): Promise<Record<string, any>> {
    const [user, auditLogs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.auditLog.findMany({
        where: {
          organizationId,
          actorId: userId,
        },
        take: 1000,
      }),
    ]);

    return {
      exportDate: new Date().toISOString(),
      user: user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      } : null,
      activityLogs: auditLogs.map(log => ({
        timestamp: log.timestamp,
        action: log.action,
        details: log.payload,
      })),
    };
  }

  /**
   * Delete user data (GDPR right to erasure)
   */
  async deleteUserData(
    organizationId: string,
    userId: string
  ): Promise<{ deletedRecords: number }> {
    let deletedRecords = 0;

    // Anonymize audit logs (can't delete for compliance)
    const logs = await this.prisma.auditLog.updateMany({
      where: {
        organizationId,
        actorId: userId,
      },
      data: {
        actorId: null,
        payload: { anonymized: true },
      },
    });
    deletedRecords += logs.count;

    // Delete user
    await this.prisma.user.delete({ where: { id: userId } });
    deletedRecords += 1;

    return { deletedRecords };
  }
}

// =============================================================================
// COMPLIANCE MODULE FACADE
// =============================================================================

export class ComplianceModule {
  public readonly aiAct: AIActAssessmentService;
  public readonly humanOversight: HumanOversightService;
  public readonly auditExport: AuditExportService;
  public readonly dataRetention: DataRetentionService;

  constructor() {
    this.aiAct = new AIActAssessmentService();
    this.humanOversight = new HumanOversightService();
    this.auditExport = new AuditExportService();
    this.dataRetention = new DataRetentionService();
  }
}

/**
 * Create Compliance Module instance
 */
export function createComplianceModule(): ComplianceModule {
  return new ComplianceModule();
}
