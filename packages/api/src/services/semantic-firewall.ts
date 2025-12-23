/**
 * Guthwine - Semantic Firewall
 * LLM-based risk assessment for transaction reasoning
 */

import OpenAI from 'openai';

export interface SemanticEvaluationInput {
  reasoningTrace: string;
  amount: number;
  currency: string;
  merchantName: string;
  agentName: string;
  constraints?: string;
}

export interface SemanticEvaluationResult {
  compliant: boolean;
  confidence: number;
  reasoning: string;
  riskFactors: string[];
  suggestedAction: 'ALLOW' | 'FLAG' | 'DENY';
}

export class SemanticFirewall {
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    this.model = process.env.LLM_MODEL || 'gpt-4.1-mini';
    
    if (process.env.OPENAI_API_KEY) {
      this.client = new OpenAI();
    }
  }

  /**
   * Evaluate a transaction's reasoning trace
   */
  async evaluate(input: SemanticEvaluationInput): Promise<SemanticEvaluationResult> {
    if (!this.client) {
      // Return permissive result if no LLM configured
      return {
        compliant: true,
        confidence: 0.5,
        reasoning: 'LLM not configured, skipping semantic evaluation',
        riskFactors: [],
        suggestedAction: 'ALLOW',
      };
    }

    const systemPrompt = `You are a security analyst evaluating AI agent transaction requests.
Your job is to assess whether the agent's reasoning trace justifies the requested transaction.

Evaluate for:
1. Logical consistency - Does the reasoning make sense?
2. User intent alignment - Does this seem to serve the user's interests?
3. Risk indicators - Are there signs of manipulation, fraud, or unauthorized activity?
4. Policy compliance - Does it violate any stated constraints?

Respond in JSON format:
{
  "compliant": boolean,
  "confidence": number (0-1),
  "reasoning": "explanation",
  "riskFactors": ["factor1", "factor2"],
  "suggestedAction": "ALLOW" | "FLAG" | "DENY"
}`;

    const userPrompt = `Evaluate this transaction request:

Agent: ${input.agentName}
Amount: ${input.amount} ${input.currency}
Merchant: ${input.merchantName}
${input.constraints ? `Constraints: ${input.constraints}` : ''}

Agent's Reasoning:
${input.reasoningTrace}

Provide your assessment in JSON format.`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from LLM');
      }

      const result = JSON.parse(content);
      return {
        compliant: result.compliant ?? true,
        confidence: result.confidence ?? 0.5,
        reasoning: result.reasoning ?? 'No reasoning provided',
        riskFactors: result.riskFactors ?? [],
        suggestedAction: result.suggestedAction ?? 'ALLOW',
      };
    } catch (error) {
      console.error('Semantic firewall error:', error);
      return {
        compliant: true,
        confidence: 0.3,
        reasoning: 'Error during evaluation, defaulting to permissive',
        riskFactors: ['EVALUATION_ERROR'],
        suggestedAction: 'FLAG',
      };
    }
  }
}

export const semanticFirewall = new SemanticFirewall();
