/**
 * Guthwine - Semantic Firewall
 * Intent-based transaction filtering using LLM classification
 */

import OpenAI from 'openai';
import type { TransactionRequest } from '../types/index.js';

export interface RiskAssessment {
  riskScore: number; // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresHumanApproval: boolean;
  reasons: string[];
  confidence: number;
  categories: string[];
}

export interface SemanticFirewallConfig {
  riskThreshold: number; // Score above which human approval is required
  enabledCategories: string[]; // Categories to flag
  blockedPatterns: string[]; // Patterns to always block
}

export class SemanticFirewall {
  private openai: OpenAI;
  private config: SemanticFirewallConfig;

  constructor(config?: Partial<SemanticFirewallConfig>) {
    this.openai = new OpenAI();
    this.config = {
      riskThreshold: config?.riskThreshold || 70,
      enabledCategories: config?.enabledCategories || [
        'gambling',
        'cryptocurrency',
        'high_value',
        'unusual_merchant',
        'misaligned_intent',
        'recursive_spending',
        'data_exfiltration',
      ],
      blockedPatterns: config?.blockedPatterns || [
        'transfer to unknown wallet',
        'maximum withdrawal',
        'liquidate all',
        'urgent transfer',
      ],
    };
  }

  /**
   * Assess the risk of a transaction
   */
  async assessRisk(
    transaction: TransactionRequest,
    agentContext?: {
      recentTransactions?: { amount: number; merchant: string; timestamp: Date }[];
      originalIntent?: string;
      agentCapabilities?: string[];
    }
  ): Promise<RiskAssessment> {
    // Quick pattern check first
    const patternMatch = this.checkBlockedPatterns(transaction);
    if (patternMatch) {
      return {
        riskScore: 100,
        riskLevel: 'CRITICAL',
        requiresHumanApproval: true,
        reasons: [`Blocked pattern detected: ${patternMatch}`],
        confidence: 1.0,
        categories: ['blocked_pattern'],
      };
    }

    // LLM-based risk assessment
    const prompt = this.buildRiskAssessmentPrompt(transaction, agentContext);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.getDefaultAssessment('LLM returned empty response');
      }

      const result = JSON.parse(content);
      const riskScore = Math.min(100, Math.max(0, Number(result.risk_score) || 50));
      
      return {
        riskScore,
        riskLevel: this.getRiskLevel(riskScore),
        requiresHumanApproval: riskScore >= this.config.riskThreshold,
        reasons: Array.isArray(result.reasons) ? result.reasons : [],
        confidence: Number(result.confidence) || 0.5,
        categories: Array.isArray(result.categories) ? result.categories : [],
      };
    } catch (error) {
      console.error('Semantic firewall error:', error);
      return this.getDefaultAssessment('Risk assessment failed');
    }
  }

  /**
   * Check for blocked patterns in the transaction
   */
  private checkBlockedPatterns(transaction: TransactionRequest): string | null {
    const textToCheck = [
      transaction.reasoningTrace,
      transaction.merchantName,
      JSON.stringify(transaction.metadata),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    for (const pattern of this.config.blockedPatterns) {
      if (textToCheck.includes(pattern.toLowerCase())) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Build the risk assessment prompt
   */
  private buildRiskAssessmentPrompt(
    transaction: TransactionRequest,
    context?: {
      recentTransactions?: { amount: number; merchant: string; timestamp: Date }[];
      originalIntent?: string;
      agentCapabilities?: string[];
    }
  ): string {
    let prompt = `You are a financial security AI assessing the risk of an AI agent transaction.

TRANSACTION DETAILS:
- Amount: ${transaction.amount} ${transaction.currency}
- Merchant ID: ${transaction.merchantId}
- Merchant Name: ${transaction.merchantName || 'Unknown'}
- Merchant Category: ${transaction.merchantCategory || 'Unknown'}
- Agent's Reasoning: "${transaction.reasoningTrace}"
- Additional Metadata: ${JSON.stringify(transaction.metadata || {})}
`;

    if (context?.originalIntent) {
      prompt += `\nORIGINAL USER INTENT: "${context.originalIntent}"`;
    }

    if (context?.recentTransactions && context.recentTransactions.length > 0) {
      prompt += `\nRECENT TRANSACTIONS (last 5):`;
      for (const tx of context.recentTransactions.slice(-5)) {
        prompt += `\n- $${tx.amount} at ${tx.merchant} (${tx.timestamp.toISOString()})`;
      }
    }

    if (context?.agentCapabilities) {
      prompt += `\nAGENT CAPABILITIES: ${context.agentCapabilities.join(', ')}`;
    }

    prompt += `

RISK CATEGORIES TO EVALUATE:
${this.config.enabledCategories.map((c) => `- ${c}`).join('\n')}

TASK:
Assess the risk of this transaction. Consider:
1. Does the agent's reasoning align with the original intent?
2. Is the amount appropriate for the stated purpose?
3. Is the merchant appropriate for the stated purpose?
4. Are there signs of misalignment, hallucination, or manipulation?
5. Does this look like a potential "runaway agent" scenario?
6. Could this be an attempt to exfiltrate funds or data?

Respond in JSON format:
{
  "risk_score": 0-100,
  "reasons": ["reason1", "reason2"],
  "categories": ["category1", "category2"],
  "confidence": 0.0-1.0,
  "recommendation": "ALLOW" | "REVIEW" | "BLOCK"
}`;

    return prompt;
  }

  /**
   * Get risk level from score
   */
  private getRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (score < 30) return 'LOW';
    if (score < 60) return 'MEDIUM';
    if (score < 85) return 'HIGH';
    return 'CRITICAL';
  }

  /**
   * Get default assessment for error cases
   */
  private getDefaultAssessment(reason: string): RiskAssessment {
    return {
      riskScore: 75, // Fail towards caution
      riskLevel: 'HIGH',
      requiresHumanApproval: true,
      reasons: [reason],
      confidence: 0,
      categories: ['assessment_error'],
    };
  }

  /**
   * Check alignment between agent reasoning and original intent
   */
  async checkAlignment(
    reasoningTrace: string,
    originalIntent: string
  ): Promise<{
    aligned: boolean;
    alignmentScore: number;
    explanation: string;
  }> {
    const prompt = `Compare the AI agent's reasoning with the original user intent.

ORIGINAL USER INTENT:
"${originalIntent}"

AGENT'S REASONING:
"${reasoningTrace}"

TASK:
Determine if the agent's reasoning is aligned with the user's original intent.
Consider semantic similarity, goal alignment, and potential drift.

Respond in JSON format:
{
  "aligned": true/false,
  "alignment_score": 0.0-1.0,
  "explanation": "Brief explanation"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-nano',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { aligned: false, alignmentScore: 0, explanation: 'Check failed' };
      }

      const result = JSON.parse(content);
      return {
        aligned: Boolean(result.aligned),
        alignmentScore: Number(result.alignment_score) || 0,
        explanation: String(result.explanation || 'No explanation'),
      };
    } catch (error) {
      return {
        aligned: false,
        alignmentScore: 0,
        explanation: 'Alignment check failed due to error',
      };
    }
  }

  /**
   * Detect potential recursive spending loops
   */
  detectRecursivePattern(
    recentTransactions: { amount: number; merchantId: string; timestamp: Date }[]
  ): {
    detected: boolean;
    pattern?: string;
    confidence: number;
  } {
    if (recentTransactions.length < 3) {
      return { detected: false, confidence: 1.0 };
    }

    // Check for repeated merchants
    const merchantCounts = new Map<string, number>();
    for (const tx of recentTransactions) {
      merchantCounts.set(tx.merchantId, (merchantCounts.get(tx.merchantId) || 0) + 1);
    }

    const maxRepeats = Math.max(...merchantCounts.values());
    if (maxRepeats >= 3) {
      const repeatedMerchant = [...merchantCounts.entries()].find(
        ([, count]) => count === maxRepeats
      )?.[0];
      return {
        detected: true,
        pattern: `Repeated transactions to merchant ${repeatedMerchant}`,
        confidence: 0.8,
      };
    }

    // Check for escalating amounts
    const amounts = recentTransactions.map((tx) => tx.amount);
    let escalating = true;
    for (let i = 1; i < amounts.length; i++) {
      if (amounts[i] <= amounts[i - 1]) {
        escalating = false;
        break;
      }
    }

    if (escalating && amounts.length >= 3) {
      return {
        detected: true,
        pattern: 'Escalating transaction amounts detected',
        confidence: 0.7,
      };
    }

    // Check for rapid succession
    const timestamps = recentTransactions.map((tx) => tx.timestamp.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avgInterval < 5000 && intervals.length >= 2) {
      // Less than 5 seconds average
      return {
        detected: true,
        pattern: 'Rapid succession transactions (possible runaway loop)',
        confidence: 0.9,
      };
    }

    return { detected: false, confidence: 1.0 };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SemanticFirewallConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): SemanticFirewallConfig {
    return { ...this.config };
  }
}
