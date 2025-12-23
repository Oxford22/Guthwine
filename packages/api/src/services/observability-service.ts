/**
 * Observability Service
 * 
 * Features:
 * - OpenTelemetry tracing integration
 * - Prometheus metrics endpoint
 * - Grafana dashboard configuration
 * - PagerDuty/Slack alerting
 */

import * as crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
}

export interface Span {
  name: string;
  context: SpanContext;
  startTime: number;
  endTime?: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface MetricValue {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  duration: string;
  severity: 'critical' | 'warning' | 'info';
  channels: string[];
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  metadata: Record<string, any>;
}

// =============================================================================
// OPENTELEMETRY TRACER
// =============================================================================

export class Tracer {
  private serviceName: string;
  private activeSpans: Map<string, Span> = new Map();
  private exporters: TraceExporter[] = [];

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  /**
   * Add a trace exporter
   */
  addExporter(exporter: TraceExporter): void {
    this.exporters.push(exporter);
  }

  /**
   * Start a new span
   */
  startSpan(name: string, parentContext?: SpanContext): Span {
    const traceId = parentContext?.traceId ?? this.generateTraceId();
    const spanId = this.generateSpanId();

    const span: Span = {
      name,
      context: {
        traceId,
        spanId,
        parentSpanId: parentContext?.spanId,
        traceFlags: 1, // Sampled
      },
      startTime: Date.now(),
      status: 'UNSET',
      attributes: {
        'service.name': this.serviceName,
      },
      events: [],
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  /**
   * End a span
   */
  endSpan(span: Span, status: 'OK' | 'ERROR' = 'OK'): void {
    span.endTime = Date.now();
    span.status = status;
    this.activeSpans.delete(span.context.spanId);

    // Export span
    for (const exporter of this.exporters) {
      exporter.export(span);
    }
  }

  /**
   * Add event to span
   */
  addEvent(span: Span, name: string, attributes?: Record<string, string | number | boolean>): void {
    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set span attribute
   */
  setAttribute(span: Span, key: string, value: string | number | boolean): void {
    span.attributes[key] = value;
  }

  /**
   * Create a traced function wrapper
   */
  trace<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.startSpan(name);
    return fn(span)
      .then(result => {
        this.endSpan(span, 'OK');
        return result;
      })
      .catch(error => {
        this.setAttribute(span, 'error', true);
        this.setAttribute(span, 'error.message', error.message);
        this.endSpan(span, 'ERROR');
        throw error;
      });
  }

  private generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }
}

export interface TraceExporter {
  export(span: Span): void;
}

/**
 * Console exporter for development
 */
export class ConsoleTraceExporter implements TraceExporter {
  export(span: Span): void {
    const duration = span.endTime ? span.endTime - span.startTime : 0;
    console.log(JSON.stringify({
      type: 'trace',
      name: span.name,
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      parentSpanId: span.context.parentSpanId,
      duration: `${duration}ms`,
      status: span.status,
      attributes: span.attributes,
      events: span.events,
    }));
  }
}

/**
 * OTLP HTTP exporter
 */
export class OTLPHttpExporter implements TraceExporter {
  private endpoint: string;
  private headers: Record<string, string>;

  constructor(endpoint: string, headers: Record<string, string> = {}) {
    this.endpoint = endpoint;
    this.headers = headers;
  }

  export(span: Span): void {
    const payload = {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: span.attributes['service.name'] } },
          ],
        },
        scopeSpans: [{
          spans: [{
            traceId: span.context.traceId,
            spanId: span.context.spanId,
            parentSpanId: span.context.parentSpanId,
            name: span.name,
            kind: 1, // INTERNAL
            startTimeUnixNano: span.startTime * 1000000,
            endTimeUnixNano: (span.endTime ?? span.startTime) * 1000000,
            status: { code: span.status === 'OK' ? 1 : span.status === 'ERROR' ? 2 : 0 },
            attributes: Object.entries(span.attributes).map(([key, value]) => ({
              key,
              value: typeof value === 'string' ? { stringValue: value } :
                     typeof value === 'number' ? { intValue: value } :
                     { boolValue: value },
            })),
          }],
        }],
      }],
    };

    // Fire and forget
    fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
}

// =============================================================================
// PROMETHEUS METRICS
// =============================================================================

export class MetricsRegistry {
  private counters: Map<string, { value: number; labels: Record<string, string>[] }> = new Map();
  private gauges: Map<string, { value: number; labels: Record<string, string> }[]> = new Map();
  private histograms: Map<string, { buckets: number[]; values: number[]; sum: number; count: number; labels: Record<string, string> }[]> = new Map();

  /**
   * Increment a counter
   */
  incCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) ?? { value: 0, labels: [labels] };
    current.value += value;
    this.counters.set(key, current);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getKey(name, labels);
    const existing = this.gauges.get(name) ?? [];
    const idx = existing.findIndex(g => this.labelsMatch(g.labels, labels));
    if (idx >= 0 && existing[idx]) {
      existing[idx].value = value;
    } else {
      existing.push({ value, labels });
    }
    this.gauges.set(name, existing);
  }

  /**
   * Observe a histogram value
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}, buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]): void {
    const existing = this.histograms.get(name) ?? [];
    let histogram = existing.find(h => this.labelsMatch(h.labels, labels));
    
    if (!histogram) {
      histogram = {
        buckets,
        values: new Array(buckets.length).fill(0),
        sum: 0,
        count: 0,
        labels,
      };
      existing.push(histogram);
      this.histograms.set(name, existing);
    }

    histogram.sum += value;
    histogram.count += 1;
    for (let i = 0; i < histogram.buckets.length; i++) {
      const bucket = histogram.buckets[i];
      if (bucket !== undefined && value <= bucket) {
        histogram.values[i] = (histogram.values[i] ?? 0) + 1;
      }
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];

    // Export counters
    for (const [key, data] of this.counters) {
      const name = key.split('{')[0];
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${key} ${data.value}`);
    }

    // Export gauges
    for (const [name, values] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const { value, labels } of values) {
        const labelStr = this.formatLabels(labels);
        lines.push(`${name}${labelStr} ${value}`);
      }
    }

    // Export histograms
    for (const [name, histograms] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const h of histograms) {
        const labelStr = this.formatLabels(h.labels);
        let cumulative = 0;
        for (let i = 0; i < h.buckets.length; i++) {
          cumulative += h.values[i] ?? 0;
          const bucketLabels = { ...h.labels, le: String(h.buckets[i]) };
          lines.push(`${name}_bucket${this.formatLabels(bucketLabels)} ${cumulative}`);
        }
        lines.push(`${name}_bucket${this.formatLabels({ ...h.labels, le: '+Inf' })} ${h.count}`);
        lines.push(`${name}_sum${labelStr} ${h.sum}`);
        lines.push(`${name}_count${labelStr} ${h.count}`);
      }
    }

    return lines.join('\n');
  }

  private getKey(name: string, labels: Record<string, string>): string {
    const labelStr = this.formatLabels(labels);
    return `${name}${labelStr}`;
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
  }

  private labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => a[k] === b[k]);
  }
}

// =============================================================================
// GUTHWINE METRICS
// =============================================================================

export class GuthwineMetrics {
  private registry: MetricsRegistry;

  constructor(registry: MetricsRegistry) {
    this.registry = registry;
  }

  // Transaction metrics
  recordTransaction(status: 'approved' | 'denied' | 'pending', agentId: string, duration: number): void {
    this.registry.incCounter('guthwine_transactions_total', { status, agent_id: agentId });
    this.registry.observeHistogram('guthwine_transaction_duration_seconds', duration / 1000, { agent_id: agentId });
  }

  // Policy evaluation metrics
  recordPolicyEvaluation(result: 'allow' | 'deny', policyId: string, duration: number): void {
    this.registry.incCounter('guthwine_policy_evaluations_total', { result, policy_id: policyId });
    this.registry.observeHistogram('guthwine_policy_evaluation_duration_seconds', duration / 1000);
  }

  // Semantic firewall metrics
  recordSemanticEvaluation(riskLevel: string, duration: number): void {
    this.registry.incCounter('guthwine_semantic_evaluations_total', { risk_level: riskLevel });
    this.registry.observeHistogram('guthwine_semantic_evaluation_duration_seconds', duration / 1000);
  }

  // Delegation metrics
  recordDelegation(action: 'created' | 'revoked' | 'used', agentId: string): void {
    this.registry.incCounter('guthwine_delegations_total', { action, agent_id: agentId });
  }

  // Agent metrics
  setActiveAgents(count: number, organizationId: string): void {
    this.registry.setGauge('guthwine_active_agents', count, { organization_id: organizationId });
  }

  setFrozenAgents(count: number, organizationId: string): void {
    this.registry.setGauge('guthwine_frozen_agents', count, { organization_id: organizationId });
  }

  // Rate limiting metrics
  recordRateLimitHit(agentId: string): void {
    this.registry.incCounter('guthwine_rate_limit_hits_total', { agent_id: agentId });
  }

  // Error metrics
  recordError(errorType: string, component: string): void {
    this.registry.incCounter('guthwine_errors_total', { error_type: errorType, component });
  }

  // API metrics
  recordApiRequest(method: string, path: string, statusCode: number, duration: number): void {
    this.registry.incCounter('guthwine_api_requests_total', { method, path, status_code: String(statusCode) });
    this.registry.observeHistogram('guthwine_api_request_duration_seconds', duration / 1000, { method, path });
  }
}

// =============================================================================
// GRAFANA DASHBOARD
// =============================================================================

export function generateGrafanaDashboard(): object {
  return {
    title: 'Guthwine Governance Dashboard',
    uid: 'guthwine-main',
    tags: ['guthwine', 'governance', 'ai-agents'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      // Row 1: Overview
      {
        id: 1,
        title: 'Transactions per Second',
        type: 'stat',
        gridPos: { x: 0, y: 0, w: 6, h: 4 },
        targets: [{
          expr: 'rate(guthwine_transactions_total[5m])',
          legendFormat: 'TPS',
        }],
      },
      {
        id: 2,
        title: 'Approval Rate',
        type: 'gauge',
        gridPos: { x: 6, y: 0, w: 6, h: 4 },
        targets: [{
          expr: 'sum(rate(guthwine_transactions_total{status="approved"}[5m])) / sum(rate(guthwine_transactions_total[5m])) * 100',
          legendFormat: 'Approval %',
        }],
        fieldConfig: {
          defaults: {
            min: 0,
            max: 100,
            thresholds: {
              steps: [
                { value: 0, color: 'red' },
                { value: 70, color: 'yellow' },
                { value: 90, color: 'green' },
              ],
            },
          },
        },
      },
      {
        id: 3,
        title: 'Active Agents',
        type: 'stat',
        gridPos: { x: 12, y: 0, w: 6, h: 4 },
        targets: [{
          expr: 'sum(guthwine_active_agents)',
          legendFormat: 'Active',
        }],
      },
      {
        id: 4,
        title: 'Frozen Agents',
        type: 'stat',
        gridPos: { x: 18, y: 0, w: 6, h: 4 },
        targets: [{
          expr: 'sum(guthwine_frozen_agents)',
          legendFormat: 'Frozen',
        }],
        fieldConfig: {
          defaults: {
            color: { mode: 'thresholds' },
            thresholds: {
              steps: [
                { value: 0, color: 'green' },
                { value: 1, color: 'yellow' },
                { value: 5, color: 'red' },
              ],
            },
          },
        },
      },

      // Row 2: Transaction Details
      {
        id: 5,
        title: 'Transaction Status Over Time',
        type: 'timeseries',
        gridPos: { x: 0, y: 4, w: 12, h: 8 },
        targets: [
          { expr: 'sum(rate(guthwine_transactions_total{status="approved"}[5m]))', legendFormat: 'Approved' },
          { expr: 'sum(rate(guthwine_transactions_total{status="denied"}[5m]))', legendFormat: 'Denied' },
          { expr: 'sum(rate(guthwine_transactions_total{status="pending"}[5m]))', legendFormat: 'Pending' },
        ],
      },
      {
        id: 6,
        title: 'Transaction Latency',
        type: 'timeseries',
        gridPos: { x: 12, y: 4, w: 12, h: 8 },
        targets: [
          { expr: 'histogram_quantile(0.50, rate(guthwine_transaction_duration_seconds_bucket[5m]))', legendFormat: 'p50' },
          { expr: 'histogram_quantile(0.95, rate(guthwine_transaction_duration_seconds_bucket[5m]))', legendFormat: 'p95' },
          { expr: 'histogram_quantile(0.99, rate(guthwine_transaction_duration_seconds_bucket[5m]))', legendFormat: 'p99' },
        ],
      },

      // Row 3: Policy & Semantic
      {
        id: 7,
        title: 'Policy Evaluation Rate',
        type: 'timeseries',
        gridPos: { x: 0, y: 12, w: 8, h: 6 },
        targets: [
          { expr: 'sum(rate(guthwine_policy_evaluations_total{result="allow"}[5m]))', legendFormat: 'Allow' },
          { expr: 'sum(rate(guthwine_policy_evaluations_total{result="deny"}[5m]))', legendFormat: 'Deny' },
        ],
      },
      {
        id: 8,
        title: 'Semantic Firewall Risk Distribution',
        type: 'piechart',
        gridPos: { x: 8, y: 12, w: 8, h: 6 },
        targets: [{
          expr: 'sum by (risk_level) (increase(guthwine_semantic_evaluations_total[1h]))',
          legendFormat: '{{risk_level}}',
        }],
      },
      {
        id: 9,
        title: 'Rate Limit Hits',
        type: 'timeseries',
        gridPos: { x: 16, y: 12, w: 8, h: 6 },
        targets: [{
          expr: 'sum(rate(guthwine_rate_limit_hits_total[5m]))',
          legendFormat: 'Rate Limit Hits',
        }],
      },

      // Row 4: Errors & API
      {
        id: 10,
        title: 'Error Rate by Component',
        type: 'timeseries',
        gridPos: { x: 0, y: 18, w: 12, h: 6 },
        targets: [{
          expr: 'sum by (component) (rate(guthwine_errors_total[5m]))',
          legendFormat: '{{component}}',
        }],
      },
      {
        id: 11,
        title: 'API Request Rate by Status',
        type: 'timeseries',
        gridPos: { x: 12, y: 18, w: 12, h: 6 },
        targets: [{
          expr: 'sum by (status_code) (rate(guthwine_api_requests_total[5m]))',
          legendFormat: '{{status_code}}',
        }],
      },
    ],
  };
}

// =============================================================================
// ALERTING
// =============================================================================

export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, AlertEvent> = new Map();
  private channels: Map<string, AlertChannel> = new Map();

  /**
   * Register an alert channel
   */
  registerChannel(name: string, channel: AlertChannel): void {
    this.channels.set(name, channel);
  }

  /**
   * Add an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Get default Guthwine alert rules
   */
  getDefaultRules(): AlertRule[] {
    return [
      {
        id: 'high-denial-rate',
        name: 'High Transaction Denial Rate',
        condition: 'denial_rate > threshold',
        threshold: 30,
        duration: '5m',
        severity: 'warning',
        channels: ['slack', 'pagerduty'],
        enabled: true,
      },
      {
        id: 'agent-frozen',
        name: 'Agent Frozen',
        condition: 'agent_frozen == 1',
        threshold: 1,
        duration: '0m',
        severity: 'critical',
        channels: ['slack', 'pagerduty'],
        enabled: true,
      },
      {
        id: 'global-freeze',
        name: 'Global Freeze Activated',
        condition: 'global_freeze == 1',
        threshold: 1,
        duration: '0m',
        severity: 'critical',
        channels: ['slack', 'pagerduty', 'email'],
        enabled: true,
      },
      {
        id: 'high-latency',
        name: 'High Transaction Latency',
        condition: 'p99_latency > threshold',
        threshold: 5000,
        duration: '5m',
        severity: 'warning',
        channels: ['slack'],
        enabled: true,
      },
      {
        id: 'rate-limit-spike',
        name: 'Rate Limit Spike',
        condition: 'rate_limit_hits > threshold',
        threshold: 100,
        duration: '1m',
        severity: 'warning',
        channels: ['slack'],
        enabled: true,
      },
      {
        id: 'semantic-high-risk',
        name: 'High Risk Semantic Evaluation',
        condition: 'semantic_high_risk_count > threshold',
        threshold: 10,
        duration: '5m',
        severity: 'warning',
        channels: ['slack', 'pagerduty'],
        enabled: true,
      },
      {
        id: 'error-spike',
        name: 'Error Rate Spike',
        condition: 'error_rate > threshold',
        threshold: 5,
        duration: '5m',
        severity: 'critical',
        channels: ['slack', 'pagerduty'],
        enabled: true,
      },
    ];
  }

  /**
   * Fire an alert
   */
  async fireAlert(ruleId: string, message: string, metadata: Record<string, any> = {}): Promise<void> {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.enabled) return;

    const alertId = `${ruleId}-${Date.now()}`;
    const alert: AlertEvent = {
      id: alertId,
      ruleId,
      ruleName: rule.name,
      severity: rule.severity,
      message,
      timestamp: new Date(),
      resolved: false,
      metadata,
    };

    this.activeAlerts.set(alertId, alert);

    // Send to all configured channels
    for (const channelName of rule.channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.send(alert);
      }
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.resolved = true;
    alert.resolvedAt = new Date();

    const rule = this.rules.get(alert.ruleId);
    if (!rule) return;

    // Notify resolution
    for (const channelName of rule.channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.sendResolution(alert);
      }
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): AlertEvent[] {
    return Array.from(this.activeAlerts.values()).filter(a => !a.resolved);
  }
}

export interface AlertChannel {
  send(alert: AlertEvent): Promise<void>;
  sendResolution(alert: AlertEvent): Promise<void>;
}

/**
 * Slack alert channel
 */
export class SlackAlertChannel implements AlertChannel {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(alert: AlertEvent): Promise<void> {
    const color = alert.severity === 'critical' ? '#FF0000' :
                  alert.severity === 'warning' ? '#FFA500' : '#0000FF';

    const payload = {
      attachments: [{
        color,
        title: `🚨 ${alert.ruleName}`,
        text: alert.message,
        fields: [
          { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
          { title: 'Time', value: alert.timestamp.toISOString(), short: true },
        ],
        footer: 'Guthwine Alert Manager',
      }],
    };

    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async sendResolution(alert: AlertEvent): Promise<void> {
    const payload = {
      attachments: [{
        color: '#00FF00',
        title: `✅ Resolved: ${alert.ruleName}`,
        text: `Alert resolved at ${alert.resolvedAt?.toISOString()}`,
        footer: 'Guthwine Alert Manager',
      }],
    };

    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

/**
 * PagerDuty alert channel
 */
export class PagerDutyAlertChannel implements AlertChannel {
  private routingKey: string;
  private apiUrl = 'https://events.pagerduty.com/v2/enqueue';

  constructor(routingKey: string) {
    this.routingKey = routingKey;
  }

  async send(alert: AlertEvent): Promise<void> {
    const payload = {
      routing_key: this.routingKey,
      event_action: 'trigger',
      dedup_key: alert.id,
      payload: {
        summary: `[${alert.severity.toUpperCase()}] ${alert.ruleName}: ${alert.message}`,
        severity: alert.severity === 'critical' ? 'critical' : 
                  alert.severity === 'warning' ? 'warning' : 'info',
        source: 'guthwine',
        timestamp: alert.timestamp.toISOString(),
        custom_details: alert.metadata,
      },
    };

    await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async sendResolution(alert: AlertEvent): Promise<void> {
    const payload = {
      routing_key: this.routingKey,
      event_action: 'resolve',
      dedup_key: alert.id,
    };

    await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

// =============================================================================
// OBSERVABILITY SERVICE FACADE
// =============================================================================

export class ObservabilityService {
  public readonly tracer: Tracer;
  public readonly metrics: GuthwineMetrics;
  public readonly alerts: AlertManager;
  private registry: MetricsRegistry;

  constructor(serviceName: string = 'guthwine') {
    this.tracer = new Tracer(serviceName);
    this.registry = new MetricsRegistry();
    this.metrics = new GuthwineMetrics(this.registry);
    this.alerts = new AlertManager();

    // Add default alert rules
    for (const rule of this.alerts.getDefaultRules()) {
      this.alerts.addRule(rule);
    }
  }

  /**
   * Configure OTLP exporter
   */
  configureOTLP(endpoint: string, headers: Record<string, string> = {}): void {
    this.tracer.addExporter(new OTLPHttpExporter(endpoint, headers));
  }

  /**
   * Configure Slack alerting
   */
  configureSlack(webhookUrl: string): void {
    this.alerts.registerChannel('slack', new SlackAlertChannel(webhookUrl));
  }

  /**
   * Configure PagerDuty alerting
   */
  configurePagerDuty(routingKey: string): void {
    this.alerts.registerChannel('pagerduty', new PagerDutyAlertChannel(routingKey));
  }

  /**
   * Get Prometheus metrics endpoint content
   */
  getPrometheusMetrics(): string {
    return this.registry.export();
  }

  /**
   * Get Grafana dashboard JSON
   */
  getGrafanaDashboard(): object {
    return generateGrafanaDashboard();
  }
}

/**
 * Create Observability Service instance
 */
export function createObservabilityService(serviceName?: string): ObservabilityService {
  return new ObservabilityService(serviceName);
}
