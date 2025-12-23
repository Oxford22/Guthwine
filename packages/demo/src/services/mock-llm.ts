/**
 * Mock LLM Service for Zero-Dependency Demo
 * 
 * Provides deterministic semantic analysis without requiring an API key.
 * Uses keyword matching and heuristics to simulate LLM behavior.
 */

export interface SemanticAnalysisResult {
  approved: boolean;
  confidence: number;
  category: string;
  reasoning: string;
  riskScore: number;
  flags: string[];
}

export interface SemanticAnalysisRequest {
  action: string;
  reason: string;
  amount?: number;
  currency?: string;
  merchantId?: string;
  context?: Record<string, unknown>;
}

// Category definitions with keywords
const CATEGORIES: Record<string, { keywords: string[]; allowed: boolean; riskMultiplier: number }> = {
  infrastructure: {
    keywords: ['aws', 'azure', 'gcp', 'cloud', 'server', 'hosting', 'compute', 'storage', 'database', 'cdn', 'kubernetes', 'docker', 'vercel', 'netlify', 'heroku', 'digitalocean'],
    allowed: true,
    riskMultiplier: 0.5
  },
  software: {
    keywords: ['software', 'license', 'subscription', 'saas', 'tool', 'github', 'gitlab', 'jira', 'slack', 'notion', 'figma', 'adobe', 'microsoft', 'google workspace'],
    allowed: true,
    riskMultiplier: 0.6
  },
  development: {
    keywords: ['api', 'sdk', 'framework', 'library', 'npm', 'package', 'development', 'testing', 'ci/cd', 'devops'],
    allowed: true,
    riskMultiplier: 0.4
  },
  marketing: {
    keywords: ['marketing', 'advertising', 'ads', 'campaign', 'seo', 'social media', 'content', 'branding'],
    allowed: true,
    riskMultiplier: 0.7
  },
  office: {
    keywords: ['office', 'supplies', 'equipment', 'furniture', 'printer', 'stationery'],
    allowed: true,
    riskMultiplier: 0.3
  },
  travel: {
    keywords: ['travel', 'flight', 'hotel', 'transportation', 'uber', 'lyft', 'airbnb', 'booking'],
    allowed: true,
    riskMultiplier: 0.8
  },
  gambling: {
    keywords: ['casino', 'gambling', 'betting', 'poker', 'lottery', 'slots', 'wager'],
    allowed: false,
    riskMultiplier: 5.0
  },
  adult: {
    keywords: ['adult', 'xxx', 'nsfw', 'explicit'],
    allowed: false,
    riskMultiplier: 5.0
  },
  weapons: {
    keywords: ['weapon', 'gun', 'firearm', 'ammunition', 'explosive'],
    allowed: false,
    riskMultiplier: 10.0
  },
  crypto_trading: {
    keywords: ['crypto trading', 'forex', 'day trading', 'leverage', 'margin'],
    allowed: false,
    riskMultiplier: 4.0
  },
  personal: {
    keywords: ['personal', 'gift', 'entertainment', 'game', 'movie', 'music', 'streaming', 'netflix', 'spotify'],
    allowed: false,
    riskMultiplier: 2.0
  },
  suspicious: {
    keywords: ['urgent', 'wire transfer', 'western union', 'moneygram', 'gift card', 'bitcoin atm', 'prepaid'],
    allowed: false,
    riskMultiplier: 8.0
  }
};

// Suspicious patterns that increase risk
const SUSPICIOUS_PATTERNS = [
  { pattern: /urgent|immediately|asap/i, riskIncrease: 20, flag: 'URGENCY_PRESSURE' },
  { pattern: /don't tell|secret|confidential/i, riskIncrease: 40, flag: 'SECRECY_REQUEST' },
  { pattern: /gift card|prepaid card/i, riskIncrease: 50, flag: 'GIFT_CARD_FRAUD' },
  { pattern: /wire transfer|western union/i, riskIncrease: 45, flag: 'WIRE_FRAUD_RISK' },
  { pattern: /crypto|bitcoin|ethereum/i, riskIncrease: 15, flag: 'CRYPTO_TRANSACTION' },
  { pattern: /overseas|foreign|international/i, riskIncrease: 10, flag: 'INTERNATIONAL_TRANSFER' },
  { pattern: /\$\d{5,}/i, riskIncrease: 25, flag: 'LARGE_AMOUNT' },
  { pattern: /bypass|override|ignore policy/i, riskIncrease: 60, flag: 'POLICY_BYPASS_ATTEMPT' },
  { pattern: /test|demo|fake/i, riskIncrease: -10, flag: 'TEST_TRANSACTION' }
];

export class MockLLMService {
  private latencyMs: number;

  constructor(options: { latencyMs?: number } = {}) {
    this.latencyMs = options.latencyMs ?? 800; // Default 800ms to simulate real LLM
  }

  async analyze(request: SemanticAnalysisRequest): Promise<SemanticAnalysisResult> {
    // Simulate LLM latency
    await this.simulateLatency();

    const text = `${request.action} ${request.reason} ${request.merchantId || ''}`.toLowerCase();
    
    // Detect category
    let detectedCategory = 'unknown';
    let categoryAllowed = true;
    let categoryRiskMultiplier = 1.0;

    for (const [category, config] of Object.entries(CATEGORIES)) {
      const matches = config.keywords.some(keyword => text.includes(keyword.toLowerCase()));
      if (matches) {
        detectedCategory = category;
        categoryAllowed = config.allowed;
        categoryRiskMultiplier = config.riskMultiplier;
        break;
      }
    }

    // Calculate base risk score
    let riskScore = 20; // Base risk
    const flags: string[] = [];

    // Apply category risk
    riskScore *= categoryRiskMultiplier;

    // Check suspicious patterns
    for (const { pattern, riskIncrease, flag } of SUSPICIOUS_PATTERNS) {
      if (pattern.test(text)) {
        riskScore += riskIncrease;
        flags.push(flag);
      }
    }

    // Amount-based risk
    if (request.amount) {
      if (request.amount > 10000) {
        riskScore += 30;
        flags.push('HIGH_VALUE_TRANSACTION');
      } else if (request.amount > 5000) {
        riskScore += 15;
        flags.push('ELEVATED_VALUE');
      } else if (request.amount > 1000) {
        riskScore += 5;
      }
    }

    // Clamp risk score
    riskScore = Math.max(0, Math.min(100, riskScore));

    // Determine approval
    const approved = categoryAllowed && riskScore < 70;
    const confidence = this.calculateConfidence(detectedCategory, flags.length);

    // Generate reasoning
    const reasoning = this.generateReasoning(
      approved,
      detectedCategory,
      riskScore,
      flags,
      request
    );

    return {
      approved,
      confidence,
      category: detectedCategory,
      reasoning,
      riskScore,
      flags
    };
  }

  private async simulateLatency(): Promise<void> {
    // Add some variance to make it feel more realistic
    const variance = Math.random() * 400 - 200; // ±200ms
    const delay = Math.max(100, this.latencyMs + variance);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private calculateConfidence(category: string, flagCount: number): number {
    let confidence = 0.85; // Base confidence

    if (category === 'unknown') {
      confidence -= 0.3;
    }

    // More flags = less confidence in the analysis
    confidence -= flagCount * 0.05;

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private generateReasoning(
    approved: boolean,
    category: string,
    riskScore: number,
    flags: string[],
    request: SemanticAnalysisRequest
  ): string {
    const parts: string[] = [];

    if (approved) {
      parts.push(`Transaction approved.`);
      parts.push(`Category: ${category} (allowed).`);
      parts.push(`Risk score: ${riskScore.toFixed(0)}/100 (acceptable).`);
      
      if (request.amount) {
        parts.push(`Amount: ${request.currency || 'USD'} ${request.amount} within limits.`);
      }
    } else {
      parts.push(`Transaction denied.`);
      
      if (category !== 'unknown' && !CATEGORIES[category]?.allowed) {
        parts.push(`Category "${category}" is not permitted by policy.`);
      }
      
      if (riskScore >= 70) {
        parts.push(`Risk score: ${riskScore.toFixed(0)}/100 (exceeds threshold of 70).`);
      }
    }

    if (flags.length > 0) {
      parts.push(`Flags: ${flags.join(', ')}.`);
    }

    return parts.join(' ');
  }

  // Batch analysis for multiple requests
  async analyzeBatch(requests: SemanticAnalysisRequest[]): Promise<SemanticAnalysisResult[]> {
    return Promise.all(requests.map(req => this.analyze(req)));
  }

  // Quick check without full analysis
  quickCheck(reason: string): { likely: 'APPROVE' | 'DENY' | 'REVIEW'; category: string } {
    const text = reason.toLowerCase();
    
    for (const [category, config] of Object.entries(CATEGORIES)) {
      const matches = config.keywords.some(keyword => text.includes(keyword.toLowerCase()));
      if (matches) {
        return {
          likely: config.allowed ? 'APPROVE' : 'DENY',
          category
        };
      }
    }

    return { likely: 'REVIEW', category: 'unknown' };
  }
}

export default MockLLMService;
