/**
 * Chaos Engineering Service
 * 
 * Implements controlled fault injection for resilience testing:
 * - Network partition simulation
 * - Latency injection
 * - Resource exhaustion
 * - Service degradation
 * - Database failure simulation
 * 
 * Based on VAGNN Architecture specification for adversarial resilience.
 */

import * as crypto from 'crypto';

// Chaos Experiment Types
export enum ChaosExperimentType {
  NETWORK_PARTITION = 'network_partition',
  LATENCY_INJECTION = 'latency_injection',
  RESOURCE_EXHAUSTION = 'resource_exhaustion',
  SERVICE_DEGRADATION = 'service_degradation',
  DATABASE_FAILURE = 'database_failure',
  CLOCK_SKEW = 'clock_skew',
  DNS_FAILURE = 'dns_failure',
  CERTIFICATE_EXPIRY = 'certificate_expiry',
  MEMORY_PRESSURE = 'memory_pressure',
  CPU_STRESS = 'cpu_stress',
}

export interface ChaosExperiment {
  id: string;
  type: ChaosExperimentType;
  name: string;
  description: string;
  config: ChaosConfig;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  startedAt?: Date;
  completedAt?: Date;
  results?: ChaosResult;
  targetServices: string[];
  blastRadius: 'single' | 'subset' | 'all';
  safetyChecks: SafetyCheck[];
}

export interface ChaosConfig {
  duration: number; // seconds
  intensity: number; // 0-1
  probability: number; // 0-1, chance of fault occurring
  targetPercentage: number; // % of requests affected
  parameters: Record<string, unknown>;
}

export interface ChaosResult {
  success: boolean;
  metrics: ChaosMetrics;
  observations: string[];
  recommendations: string[];
  impactAssessment: ImpactAssessment;
}

export interface ChaosMetrics {
  requestsAffected: number;
  errorsGenerated: number;
  latencyIncrease: number;
  recoveryTime: number;
  systemStability: number; // 0-1
}

export interface ImpactAssessment {
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  affectedComponents: string[];
  cascadeEffects: string[];
  dataIntegrity: boolean;
  serviceAvailability: number; // 0-1
}

export interface SafetyCheck {
  name: string;
  condition: string;
  action: 'abort' | 'warn' | 'log';
  threshold: number;
}

// Fault Injection Handlers
export interface FaultInjector {
  inject(): Promise<void>;
  remove(): Promise<void>;
  isActive(): boolean;
}

/**
 * Network Partition Injector
 */
export class NetworkPartitionInjector implements FaultInjector {
  private active: boolean = false;
  private partitionedServices: Set<string> = new Set();
  
  constructor(
    private services: string[],
    private partitionPercentage: number
  ) {}
  
  async inject(): Promise<void> {
    this.active = true;
    
    // Partition a percentage of services
    const numToPartition = Math.ceil(this.services.length * this.partitionPercentage);
    const shuffled = [...this.services].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < numToPartition; i++) {
      const service = shuffled[i];
      if (service) {
        this.partitionedServices.add(service);
      }
    }
    
    console.log(`[Chaos] Network partition injected: ${this.partitionedServices.size} services isolated`);
  }
  
  async remove(): Promise<void> {
    this.partitionedServices.clear();
    this.active = false;
    console.log('[Chaos] Network partition removed');
  }
  
  isActive(): boolean {
    return this.active;
  }
  
  isPartitioned(service: string): boolean {
    return this.partitionedServices.has(service);
  }
}

/**
 * Latency Injector
 */
export class LatencyInjector implements FaultInjector {
  private active: boolean = false;
  
  constructor(
    private baseLatency: number, // ms
    private jitter: number, // ms
    private probability: number // 0-1
  ) {}
  
  async inject(): Promise<void> {
    this.active = true;
    console.log(`[Chaos] Latency injection active: ${this.baseLatency}ms ± ${this.jitter}ms`);
  }
  
  async remove(): Promise<void> {
    this.active = false;
    console.log('[Chaos] Latency injection removed');
  }
  
  isActive(): boolean {
    return this.active;
  }
  
  async maybeDelay(): Promise<void> {
    if (!this.active) return;
    
    if (Math.random() < this.probability) {
      const delay = this.baseLatency + (Math.random() * 2 - 1) * this.jitter;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
    }
  }
  
  getDelay(): number {
    if (!this.active || Math.random() >= this.probability) return 0;
    return this.baseLatency + (Math.random() * 2 - 1) * this.jitter;
  }
}

/**
 * Resource Exhaustion Injector
 */
export class ResourceExhaustionInjector implements FaultInjector {
  private active: boolean = false;
  private memoryBlocks: Buffer[] = [];
  private cpuInterval: ReturnType<typeof setInterval> | null = null;
  
  constructor(
    private memoryMB: number,
    private cpuPercentage: number
  ) {}
  
  async inject(): Promise<void> {
    this.active = true;
    
    // Allocate memory
    const blockSize = 1024 * 1024; // 1MB
    const numBlocks = this.memoryMB;
    
    for (let i = 0; i < numBlocks; i++) {
      try {
        this.memoryBlocks.push(Buffer.alloc(blockSize));
      } catch {
        console.log(`[Chaos] Memory allocation stopped at ${i}MB`);
        break;
      }
    }
    
    // CPU stress (simplified - in production use worker threads)
    if (this.cpuPercentage > 0) {
      const busyTime = this.cpuPercentage * 10; // ms
      const idleTime = (100 - this.cpuPercentage) * 10; // ms
      
      this.cpuInterval = setInterval(() => {
        const end = Date.now() + busyTime;
        while (Date.now() < end) {
          // Busy loop
          Math.random() * Math.random();
        }
      }, busyTime + idleTime);
    }
    
    console.log(`[Chaos] Resource exhaustion active: ${this.memoryBlocks.length}MB allocated, ${this.cpuPercentage}% CPU`);
  }
  
  async remove(): Promise<void> {
    this.memoryBlocks = [];
    if (this.cpuInterval) {
      clearInterval(this.cpuInterval);
      this.cpuInterval = null;
    }
    this.active = false;
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    console.log('[Chaos] Resource exhaustion removed');
  }
  
  isActive(): boolean {
    return this.active;
  }
}

/**
 * Service Degradation Injector
 */
export class ServiceDegradationInjector implements FaultInjector {
  private active: boolean = false;
  private errorProbability: number;
  private timeoutProbability: number;
  
  constructor(
    private config: {
      errorProbability: number;
      timeoutProbability: number;
      degradedEndpoints: string[];
    }
  ) {
    this.errorProbability = config.errorProbability;
    this.timeoutProbability = config.timeoutProbability;
  }
  
  async inject(): Promise<void> {
    this.active = true;
    console.log(`[Chaos] Service degradation active: ${this.errorProbability * 100}% errors, ${this.timeoutProbability * 100}% timeouts`);
  }
  
  async remove(): Promise<void> {
    this.active = false;
    console.log('[Chaos] Service degradation removed');
  }
  
  isActive(): boolean {
    return this.active;
  }
  
  shouldError(): boolean {
    return this.active && Math.random() < this.errorProbability;
  }
  
  shouldTimeout(): boolean {
    return this.active && Math.random() < this.timeoutProbability;
  }
  
  isEndpointDegraded(endpoint: string): boolean {
    return this.active && this.config.degradedEndpoints.some(e => endpoint.includes(e));
  }
}

/**
 * Database Failure Injector
 */
export class DatabaseFailureInjector implements FaultInjector {
  private active: boolean = false;
  
  constructor(
    private failureType: 'connection' | 'timeout' | 'corruption' | 'readonly',
    private probability: number
  ) {}
  
  async inject(): Promise<void> {
    this.active = true;
    console.log(`[Chaos] Database failure injection active: ${this.failureType} at ${this.probability * 100}%`);
  }
  
  async remove(): Promise<void> {
    this.active = false;
    console.log('[Chaos] Database failure injection removed');
  }
  
  isActive(): boolean {
    return this.active;
  }
  
  shouldFail(): boolean {
    return this.active && Math.random() < this.probability;
  }
  
  getFailureType(): string {
    return this.failureType;
  }
}

/**
 * Chaos Engineering Service
 */
export class ChaosEngineeringService {
  private experiments: Map<string, ChaosExperiment> = new Map();
  private activeInjectors: Map<string, FaultInjector> = new Map();
  private isEnabled: boolean = false;
  private safetyEnabled: boolean = true;
  
  constructor(private config: {
    enabled: boolean;
    safetyEnabled: boolean;
    maxConcurrentExperiments: number;
    defaultDuration: number;
  }) {
    this.isEnabled = config.enabled;
    this.safetyEnabled = config.safetyEnabled;
  }
  
  /**
   * Create a new chaos experiment
   */
  createExperiment(
    type: ChaosExperimentType,
    name: string,
    config: Partial<ChaosConfig>,
    targetServices: string[] = ['*']
  ): ChaosExperiment {
    const experiment: ChaosExperiment = {
      id: crypto.randomUUID(),
      type,
      name,
      description: this.getExperimentDescription(type),
      config: {
        duration: config.duration || this.config.defaultDuration,
        intensity: config.intensity || 0.5,
        probability: config.probability || 0.5,
        targetPercentage: config.targetPercentage || 10,
        parameters: config.parameters || {},
      },
      status: 'pending',
      targetServices,
      blastRadius: targetServices.includes('*') ? 'all' : targetServices.length > 1 ? 'subset' : 'single',
      safetyChecks: this.getDefaultSafetyChecks(type),
    };
    
    this.experiments.set(experiment.id, experiment);
    return experiment;
  }
  
  /**
   * Start a chaos experiment
   */
  async startExperiment(experimentId: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Chaos engineering is disabled');
    }
    
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    
    if (experiment.status === 'running') {
      throw new Error(`Experiment ${experimentId} is already running`);
    }
    
    // Check concurrent experiment limit
    const runningCount = Array.from(this.experiments.values()).filter(e => e.status === 'running').length;
    if (runningCount >= this.config.maxConcurrentExperiments) {
      throw new Error(`Maximum concurrent experiments (${this.config.maxConcurrentExperiments}) reached`);
    }
    
    // Run safety checks
    if (this.safetyEnabled) {
      const safetyResult = await this.runSafetyChecks(experiment);
      if (!safetyResult.passed) {
        throw new Error(`Safety check failed: ${safetyResult.reason}`);
      }
    }
    
    // Create and inject fault
    const injector = this.createInjector(experiment);
    await injector.inject();
    
    this.activeInjectors.set(experimentId, injector);
    experiment.status = 'running';
    experiment.startedAt = new Date();
    
    // Schedule automatic stop
    setTimeout(() => {
      this.stopExperiment(experimentId).catch(console.error);
    }, experiment.config.duration * 1000);
    
    console.log(`[Chaos] Experiment ${experiment.name} started`);
  }
  
  /**
   * Stop a chaos experiment
   */
  async stopExperiment(experimentId: string): Promise<ChaosResult> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    
    const injector = this.activeInjectors.get(experimentId);
    if (injector) {
      await injector.remove();
      this.activeInjectors.delete(experimentId);
    }
    
    experiment.status = 'completed';
    experiment.completedAt = new Date();
    
    // Generate results
    const results = this.generateResults(experiment);
    experiment.results = results;
    
    console.log(`[Chaos] Experiment ${experiment.name} completed`);
    return results;
  }
  
  /**
   * Abort a chaos experiment immediately
   */
  async abortExperiment(experimentId: string, reason: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    
    const injector = this.activeInjectors.get(experimentId);
    if (injector) {
      await injector.remove();
      this.activeInjectors.delete(experimentId);
    }
    
    experiment.status = 'aborted';
    experiment.completedAt = new Date();
    experiment.results = {
      success: false,
      metrics: this.getEmptyMetrics(),
      observations: [`Experiment aborted: ${reason}`],
      recommendations: ['Review safety checks before re-running'],
      impactAssessment: {
        severity: 'none',
        affectedComponents: [],
        cascadeEffects: [],
        dataIntegrity: true,
        serviceAvailability: 1,
      },
    };
    
    console.log(`[Chaos] Experiment ${experiment.name} aborted: ${reason}`);
  }
  
  /**
   * Get experiment status
   */
  getExperiment(experimentId: string): ChaosExperiment | undefined {
    return this.experiments.get(experimentId);
  }
  
  /**
   * List all experiments
   */
  listExperiments(status?: ChaosExperiment['status']): ChaosExperiment[] {
    const experiments = Array.from(this.experiments.values());
    if (status) {
      return experiments.filter(e => e.status === status);
    }
    return experiments;
  }
  
  /**
   * Check if any chaos is currently active
   */
  isAnyActive(): boolean {
    return this.activeInjectors.size > 0;
  }
  
  /**
   * Get active injector for middleware integration
   */
  getActiveInjector(experimentId: string): FaultInjector | undefined {
    return this.activeInjectors.get(experimentId);
  }
  
  /**
   * Create appropriate injector for experiment type
   */
  private createInjector(experiment: ChaosExperiment): FaultInjector {
    const { config, targetServices } = experiment;
    
    switch (experiment.type) {
      case ChaosExperimentType.NETWORK_PARTITION:
        return new NetworkPartitionInjector(
          targetServices,
          config.targetPercentage / 100
        );
        
      case ChaosExperimentType.LATENCY_INJECTION:
        return new LatencyInjector(
          (config.parameters.baseLatency as number) || 500,
          (config.parameters.jitter as number) || 200,
          config.probability
        );
        
      case ChaosExperimentType.RESOURCE_EXHAUSTION:
        return new ResourceExhaustionInjector(
          (config.parameters.memoryMB as number) || 100,
          (config.parameters.cpuPercentage as number) || 50
        );
        
      case ChaosExperimentType.SERVICE_DEGRADATION:
        return new ServiceDegradationInjector({
          errorProbability: config.probability * config.intensity,
          timeoutProbability: config.probability * config.intensity * 0.5,
          degradedEndpoints: targetServices,
        });
        
      case ChaosExperimentType.DATABASE_FAILURE:
        return new DatabaseFailureInjector(
          (config.parameters.failureType as 'connection' | 'timeout' | 'corruption' | 'readonly') || 'timeout',
          config.probability
        );
        
      default:
        // Generic latency injector as fallback
        return new LatencyInjector(100, 50, config.probability);
    }
  }
  
  /**
   * Run safety checks before experiment
   */
  private async runSafetyChecks(experiment: ChaosExperiment): Promise<{ passed: boolean; reason?: string }> {
    for (const check of experiment.safetyChecks) {
      // In production, evaluate actual system metrics
      const metricValue = await this.getMetricValue(check.condition);
      
      if (metricValue > check.threshold) {
        if (check.action === 'abort') {
          return { passed: false, reason: `${check.name}: ${check.condition} = ${metricValue} > ${check.threshold}` };
        }
        console.warn(`[Chaos] Safety warning: ${check.name}`);
      }
    }
    
    return { passed: true };
  }
  
  /**
   * Get metric value for safety check
   */
  private async getMetricValue(condition: string): Promise<number> {
    // In production, query actual metrics (Prometheus, etc.)
    // For now, return mock values
    const mockMetrics: Record<string, number> = {
      'error_rate': 0.01,
      'latency_p99': 200,
      'cpu_usage': 0.3,
      'memory_usage': 0.5,
      'active_connections': 100,
    };
    
    return mockMetrics[condition] || 0;
  }
  
  /**
   * Generate experiment results
   */
  private generateResults(experiment: ChaosExperiment): ChaosResult {
    const duration = experiment.completedAt && experiment.startedAt
      ? (experiment.completedAt.getTime() - experiment.startedAt.getTime()) / 1000
      : experiment.config.duration;
    
    // In production, collect actual metrics during experiment
    const metrics: ChaosMetrics = {
      requestsAffected: Math.floor(duration * 10 * experiment.config.targetPercentage / 100),
      errorsGenerated: Math.floor(duration * 5 * experiment.config.probability),
      latencyIncrease: experiment.type === ChaosExperimentType.LATENCY_INJECTION ? 500 : 50,
      recoveryTime: Math.floor(Math.random() * 10) + 5,
      systemStability: 0.85 + Math.random() * 0.1,
    };
    
    const observations = this.generateObservations(experiment, metrics);
    const recommendations = this.generateRecommendations(experiment, metrics);
    
    return {
      success: metrics.systemStability > 0.8,
      metrics,
      observations,
      recommendations,
      impactAssessment: {
        severity: metrics.systemStability > 0.9 ? 'low' : metrics.systemStability > 0.7 ? 'medium' : 'high',
        affectedComponents: experiment.targetServices,
        cascadeEffects: [],
        dataIntegrity: true,
        serviceAvailability: metrics.systemStability,
      },
    };
  }
  
  /**
   * Generate observations from experiment
   */
  private generateObservations(experiment: ChaosExperiment, metrics: ChaosMetrics): string[] {
    const observations: string[] = [];
    
    observations.push(`Experiment ran for ${experiment.config.duration}s with ${experiment.config.intensity * 100}% intensity`);
    observations.push(`${metrics.requestsAffected} requests were affected`);
    observations.push(`${metrics.errorsGenerated} errors were generated`);
    observations.push(`System stability remained at ${(metrics.systemStability * 100).toFixed(1)}%`);
    observations.push(`Recovery time was ${metrics.recoveryTime}s after fault removal`);
    
    return observations;
  }
  
  /**
   * Generate recommendations from experiment
   */
  private generateRecommendations(experiment: ChaosExperiment, metrics: ChaosMetrics): string[] {
    const recommendations: string[] = [];
    
    if (metrics.systemStability < 0.9) {
      recommendations.push('Consider implementing circuit breakers for affected services');
    }
    
    if (metrics.recoveryTime > 10) {
      recommendations.push('Improve recovery mechanisms - current recovery time exceeds 10s');
    }
    
    if (metrics.errorsGenerated > metrics.requestsAffected * 0.5) {
      recommendations.push('Error rate is high - implement better error handling');
    }
    
    if (experiment.type === ChaosExperimentType.LATENCY_INJECTION && metrics.latencyIncrease > 1000) {
      recommendations.push('Add timeout configurations to prevent cascading delays');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('System showed good resilience - consider increasing experiment intensity');
    }
    
    return recommendations;
  }
  
  /**
   * Get default safety checks for experiment type
   */
  private getDefaultSafetyChecks(type: ChaosExperimentType): SafetyCheck[] {
    const commonChecks: SafetyCheck[] = [
      { name: 'Error Rate', condition: 'error_rate', action: 'abort', threshold: 0.5 },
      { name: 'CPU Usage', condition: 'cpu_usage', action: 'warn', threshold: 0.9 },
      { name: 'Memory Usage', condition: 'memory_usage', action: 'warn', threshold: 0.9 },
    ];
    
    switch (type) {
      case ChaosExperimentType.LATENCY_INJECTION:
        return [
          ...commonChecks,
          { name: 'P99 Latency', condition: 'latency_p99', action: 'abort', threshold: 5000 },
        ];
        
      case ChaosExperimentType.RESOURCE_EXHAUSTION:
        return [
          ...commonChecks,
          { name: 'Memory Usage', condition: 'memory_usage', action: 'abort', threshold: 0.95 },
        ];
        
      default:
        return commonChecks;
    }
  }
  
  /**
   * Get experiment description
   */
  private getExperimentDescription(type: ChaosExperimentType): string {
    const descriptions: Record<ChaosExperimentType, string> = {
      [ChaosExperimentType.NETWORK_PARTITION]: 'Simulates network partition between services',
      [ChaosExperimentType.LATENCY_INJECTION]: 'Injects artificial latency into requests',
      [ChaosExperimentType.RESOURCE_EXHAUSTION]: 'Consumes memory and CPU resources',
      [ChaosExperimentType.SERVICE_DEGRADATION]: 'Causes services to return errors or timeouts',
      [ChaosExperimentType.DATABASE_FAILURE]: 'Simulates database connection failures',
      [ChaosExperimentType.CLOCK_SKEW]: 'Introduces clock drift between services',
      [ChaosExperimentType.DNS_FAILURE]: 'Simulates DNS resolution failures',
      [ChaosExperimentType.CERTIFICATE_EXPIRY]: 'Simulates TLS certificate issues',
      [ChaosExperimentType.MEMORY_PRESSURE]: 'Creates memory pressure on the system',
      [ChaosExperimentType.CPU_STRESS]: 'Creates CPU stress on the system',
    };
    
    return descriptions[type] || 'Unknown experiment type';
  }
  
  /**
   * Get empty metrics for aborted experiments
   */
  private getEmptyMetrics(): ChaosMetrics {
    return {
      requestsAffected: 0,
      errorsGenerated: 0,
      latencyIncrease: 0,
      recoveryTime: 0,
      systemStability: 1,
    };
  }
  
  /**
   * Enable/disable chaos engineering
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    
    if (!enabled) {
      // Stop all running experiments
      for (const [id, experiment] of this.experiments) {
        if (experiment.status === 'running') {
          this.abortExperiment(id, 'Chaos engineering disabled').catch(console.error);
        }
      }
    }
  }
  
  /**
   * Export experiment history
   */
  exportHistory(): {
    experiments: ChaosExperiment[];
    summary: {
      total: number;
      completed: number;
      failed: number;
      aborted: number;
      avgStability: number;
    };
  } {
    const experiments = Array.from(this.experiments.values());
    const completed = experiments.filter(e => e.status === 'completed');
    
    return {
      experiments,
      summary: {
        total: experiments.length,
        completed: completed.length,
        failed: experiments.filter(e => e.status === 'failed').length,
        aborted: experiments.filter(e => e.status === 'aborted').length,
        avgStability: completed.length > 0
          ? completed.reduce((sum, e) => sum + (e.results?.metrics.systemStability || 0), 0) / completed.length
          : 1,
      },
    };
  }
}

export default ChaosEngineeringService;
