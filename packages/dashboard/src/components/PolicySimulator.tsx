/**
 * Policy Simulation Interface
 */

import React, { useState } from 'react';
import { apiFetch } from '../lib/api';

interface SimulationContext {
  agentId: string;
  action: string;
  resource: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, any>;
}

interface SimulationResult {
  allowed: boolean;
  matchedPolicies: Array<{
    id: string;
    name: string;
    effect: 'ALLOW' | 'DENY';
    priority: number;
    matched: boolean;
    reason?: string;
  }>;
  evaluationTime: number;
  warnings: string[];
  recommendations: string[];
}

export function PolicySimulator() {
  const [context, setContext] = useState<SimulationContext>({
    agentId: '',
    action: 'payment.send',
    resource: '*',
    amount: 100,
    currency: 'USD',
    metadata: {},
  });
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ data: SimulationResult }>('/v1/policies/simulate', {
        method: 'POST',
        body: JSON.stringify(context),
      });
      setResult(response.data);
    } catch (err: any) {
      setError(err.message || 'Simulation failed');
    } finally {
      setLoading(false);
    }
  };

  const presetScenarios = [
    {
      name: 'Small Payment',
      context: { action: 'payment.send', amount: 50, currency: 'USD' },
    },
    {
      name: 'Large Payment',
      context: { action: 'payment.send', amount: 10000, currency: 'USD' },
    },
    {
      name: 'Data Access',
      context: { action: 'data.read', resource: 'user.profile' },
    },
    {
      name: 'API Call',
      context: { action: 'api.call', resource: 'external.service' },
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Policy Simulator</h3>
        <p className="text-sm text-gray-500 mt-1">
          Test how policies will evaluate for a given transaction context
        </p>
      </div>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Agent ID
            </label>
            <input
              type="text"
              value={context.agentId}
              onChange={(e) => setContext({ ...context, agentId: e.target.value })}
              placeholder="Enter agent ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Action
            </label>
            <select
              value={context.action}
              onChange={(e) => setContext({ ...context, action: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="payment.send">payment.send</option>
              <option value="payment.receive">payment.receive</option>
              <option value="data.read">data.read</option>
              <option value="data.write">data.write</option>
              <option value="api.call">api.call</option>
              <option value="agent.delegate">agent.delegate</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Resource
            </label>
            <input
              type="text"
              value={context.resource}
              onChange={(e) => setContext({ ...context, resource: e.target.value })}
              placeholder="e.g., * or specific resource"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount
              </label>
              <input
                type="number"
                value={context.amount || ''}
                onChange={(e) => setContext({ ...context, amount: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Currency
              </label>
              <select
                value={context.currency}
                onChange={(e) => setContext({ ...context, currency: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          </div>

          {/* Preset Scenarios */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quick Scenarios
            </label>
            <div className="flex flex-wrap gap-2">
              {presetScenarios.map((scenario) => (
                <button
                  key={scenario.name}
                  onClick={() => setContext({ ...context, ...scenario.context })}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200"
                >
                  {scenario.name}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={runSimulation}
            disabled={loading || !context.agentId}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {loading ? 'Running Simulation...' : 'Run Simulation'}
          </button>
        </div>

        {/* Results Section */}
        <div className="space-y-4">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {result && (
            <>
              {/* Decision */}
              <div className={`p-4 rounded-lg ${result.allowed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${result.allowed ? 'bg-green-500' : 'bg-red-500'}`}>
                    <span className="text-white text-xl">{result.allowed ? '✓' : '✕'}</span>
                  </div>
                  <div>
                    <p className={`font-semibold ${result.allowed ? 'text-green-700' : 'text-red-700'}`}>
                      {result.allowed ? 'ALLOWED' : 'DENIED'}
                    </p>
                    <p className="text-sm text-gray-500">
                      Evaluated in {result.evaluationTime}ms
                    </p>
                  </div>
                </div>
              </div>

              {/* Matched Policies */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Policy Evaluation</h4>
                <div className="space-y-2">
                  {result.matchedPolicies.map((policy) => (
                    <div
                      key={policy.id}
                      className={`p-3 rounded-md border ${
                        policy.matched
                          ? policy.effect === 'ALLOW'
                            ? 'bg-green-50 border-green-200'
                            : 'bg-red-50 border-red-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{policy.name}</p>
                          <p className="text-xs text-gray-500">Priority: {policy.priority}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 text-xs rounded ${
                            policy.effect === 'ALLOW' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {policy.effect}
                          </span>
                          {policy.matched && (
                            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                              Matched
                            </span>
                          )}
                        </div>
                      </div>
                      {policy.reason && (
                        <p className="text-sm text-gray-600 mt-1">{policy.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <h4 className="text-sm font-medium text-yellow-800 mb-1">Warnings</h4>
                  <ul className="text-sm text-yellow-700 list-disc list-inside">
                    {result.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {result.recommendations.length > 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <h4 className="text-sm font-medium text-blue-800 mb-1">Recommendations</h4>
                  <ul className="text-sm text-blue-700 list-disc list-inside">
                    {result.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {!result && !error && (
            <div className="flex items-center justify-center h-64 text-gray-400">
              <p>Run a simulation to see results</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Policy Diff Viewer
interface PolicyDiffProps {
  oldPolicy: any;
  newPolicy: any;
}

export function PolicyDiff({ oldPolicy, newPolicy }: PolicyDiffProps) {
  const getDiff = (old: any, current: any): Array<{ key: string; old: any; new: any; type: 'added' | 'removed' | 'changed' }> => {
    const diff: Array<{ key: string; old: any; new: any; type: 'added' | 'removed' | 'changed' }> = [];
    const allKeys = new Set([...Object.keys(old || {}), ...Object.keys(current || {})]);

    for (const key of allKeys) {
      if (!(key in old)) {
        diff.push({ key, old: undefined, new: current[key], type: 'added' });
      } else if (!(key in current)) {
        diff.push({ key, old: old[key], new: undefined, type: 'removed' });
      } else if (JSON.stringify(old[key]) !== JSON.stringify(current[key])) {
        diff.push({ key, old: old[key], new: current[key], type: 'changed' });
      }
    }

    return diff;
  };

  const changes = getDiff(oldPolicy, newPolicy);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="p-3 bg-gray-50 border-b border-gray-200">
        <h4 className="font-medium text-gray-900">Policy Changes</h4>
      </div>
      <div className="divide-y divide-gray-200">
        {changes.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No changes detected</div>
        ) : (
          changes.map((change) => (
            <div key={change.key} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 text-xs rounded ${
                  change.type === 'added' ? 'bg-green-100 text-green-700' :
                  change.type === 'removed' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {change.type}
                </span>
                <span className="font-mono text-sm text-gray-700">{change.key}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-2">
                {change.type !== 'added' && (
                  <div className="bg-red-50 p-2 rounded text-sm font-mono text-red-700 overflow-auto">
                    - {JSON.stringify(change.old, null, 2)}
                  </div>
                )}
                {change.type !== 'removed' && (
                  <div className="bg-green-50 p-2 rounded text-sm font-mono text-green-700 overflow-auto">
                    + {JSON.stringify(change.new, null, 2)}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
