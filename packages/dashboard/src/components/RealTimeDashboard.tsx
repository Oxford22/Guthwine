/**
 * Real-time Dashboard Component
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useGuthwineEvents, ConnectionStatus } from '../lib/websocket';

interface DashboardStats {
  totalTransactions: number;
  approvedTransactions: number;
  deniedTransactions: number;
  activeAgents: number;
  frozenAgents: number;
  totalSpent: number;
  pendingApprovals: number;
}

interface RealTimeDashboardProps {
  organizationId: string;
  initialStats?: DashboardStats;
}

export function RealTimeDashboard({ organizationId, initialStats }: RealTimeDashboardProps) {
  const { status, events, transactions, alerts } = useGuthwineEvents(organizationId);
  const [stats, setStats] = useState<DashboardStats>(initialStats || {
    totalTransactions: 0,
    approvedTransactions: 0,
    deniedTransactions: 0,
    activeAgents: 0,
    frozenAgents: 0,
    totalSpent: 0,
    pendingApprovals: 0,
  });

  // Update stats based on events
  useEffect(() => {
    if (events.length === 0) return;
    
    const latestEvent = events[0];
    setStats(prev => {
      const updated = { ...prev };
      
      switch (latestEvent.type) {
        case 'transaction.created':
          updated.totalTransactions++;
          updated.pendingApprovals++;
          break;
        case 'transaction.approved':
          updated.approvedTransactions++;
          updated.pendingApprovals = Math.max(0, updated.pendingApprovals - 1);
          if (latestEvent.payload.amount) {
            updated.totalSpent += latestEvent.payload.amount;
          }
          break;
        case 'transaction.denied':
          updated.deniedTransactions++;
          updated.pendingApprovals = Math.max(0, updated.pendingApprovals - 1);
          break;
        case 'agent.frozen':
          updated.activeAgents--;
          updated.frozenAgents++;
          break;
        case 'agent.unfrozen':
          updated.activeAgents++;
          updated.frozenAgents--;
          break;
      }
      
      return updated;
    });
  }, [events]);

  const approvalRate = useMemo(() => {
    const total = stats.approvedTransactions + stats.deniedTransactions;
    return total > 0 ? Math.round((stats.approvedTransactions / total) * 100) : 0;
  }, [stats]);

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Real-time Dashboard</h2>
        <ConnectionStatusBadge status={status} />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Transactions"
          value={stats.totalTransactions}
          icon="📊"
          trend={events.filter(e => e.type.startsWith('transaction.')).length}
        />
        <StatCard
          title="Approval Rate"
          value={`${approvalRate}%`}
          icon="✅"
          color={approvalRate >= 90 ? 'green' : approvalRate >= 70 ? 'yellow' : 'red'}
        />
        <StatCard
          title="Active Agents"
          value={stats.activeAgents}
          icon="🤖"
        />
        <StatCard
          title="Total Spent"
          value={`$${stats.totalSpent.toLocaleString()}`}
          icon="💰"
        />
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-800 mb-2">Active Alerts ({alerts.length})</h3>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-red-700">
                <span>⚠️</span>
                <span>{alert.message || 'Alert triggered'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Live Activity Feed</h3>
        </div>
        <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
          {events.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              Waiting for events...
            </div>
          ) : (
            events.slice(0, 20).map((event, i) => (
              <ActivityItem key={i} event={event} />
            ))
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      {transactions.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Recent Transactions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Agent</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Action</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {transactions.slice(0, 10).map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-mono text-gray-600">
                      {tx.id?.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-900">{tx.agentName || 'Unknown'}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{tx.action}</td>
                    <td className="px-4 py-2 text-sm text-gray-900">
                      {tx.amount ? `$${tx.amount.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-2">
                      <TransactionStatusBadge status={tx.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-components
function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connecting: { color: 'bg-yellow-100 text-yellow-700', text: 'Connecting...' },
    connected: { color: 'bg-green-100 text-green-700', text: 'Live' },
    disconnected: { color: 'bg-gray-100 text-gray-700', text: 'Disconnected' },
    error: { color: 'bg-red-100 text-red-700', text: 'Error' },
  };
  
  const { color, text } = config[status];
  
  return (
    <span className={`px-3 py-1 text-sm rounded-full flex items-center gap-2 ${color}`}>
      {status === 'connected' && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
      {text}
    </span>
  );
}

function StatCard({ 
  title, 
  value, 
  icon, 
  trend, 
  color = 'blue' 
}: { 
  title: string; 
  value: string | number; 
  icon: string; 
  trend?: number;
  color?: 'blue' | 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        {trend !== undefined && trend > 0 && (
          <span className="text-xs text-green-600">+{trend} new</span>
        )}
      </div>
      <p className="text-sm text-gray-500">{title}</p>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}

function ActivityItem({ event }: { event: any }) {
  const getEventConfig = (type: string) => {
    const configs: Record<string, { icon: string; color: string; label: string }> = {
      'transaction.created': { icon: '📝', color: 'text-blue-600', label: 'Transaction created' },
      'transaction.approved': { icon: '✅', color: 'text-green-600', label: 'Transaction approved' },
      'transaction.denied': { icon: '❌', color: 'text-red-600', label: 'Transaction denied' },
      'agent.created': { icon: '🤖', color: 'text-blue-600', label: 'Agent created' },
      'agent.frozen': { icon: '❄️', color: 'text-blue-600', label: 'Agent frozen' },
      'agent.unfrozen': { icon: '🔥', color: 'text-green-600', label: 'Agent unfrozen' },
      'policy.created': { icon: '📋', color: 'text-purple-600', label: 'Policy created' },
      'policy.updated': { icon: '📋', color: 'text-purple-600', label: 'Policy updated' },
      'delegation.created': { icon: '🔑', color: 'text-yellow-600', label: 'Delegation created' },
      'delegation.revoked': { icon: '🔒', color: 'text-red-600', label: 'Delegation revoked' },
      'alert.fired': { icon: '⚠️', color: 'text-red-600', label: 'Alert fired' },
      'alert.resolved': { icon: '✅', color: 'text-green-600', label: 'Alert resolved' },
    };
    return configs[type] || { icon: '📌', color: 'text-gray-600', label: type };
  };

  const config = getEventConfig(event.type);
  const time = new Date(event.timestamp).toLocaleTimeString();

  return (
    <div className="p-3 flex items-center gap-3">
      <span className="text-xl">{config.icon}</span>
      <div className="flex-1">
        <p className={`text-sm font-medium ${config.color}`}>{config.label}</p>
        {event.payload?.agentName && (
          <p className="text-xs text-gray-500">Agent: {event.payload.agentName}</p>
        )}
      </div>
      <span className="text-xs text-gray-400">{time}</span>
    </div>
  );
}

function TransactionStatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    DENIED: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
    FAILED: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`px-2 py-1 text-xs rounded-full ${config[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

export default RealTimeDashboard;
