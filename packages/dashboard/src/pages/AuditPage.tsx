import { useState } from 'react';
import { FileText, Search, Download, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

const mockAuditLogs = [
  { id: '1', action: 'TRANSACTION_APPROVED', actor: 'Shopping Assistant', target: 'tx_abc123', severity: 'INFO', timestamp: new Date(Date.now() - 300000), details: 'Transaction approved: $125.99 at Amazon' },
  { id: '2', action: 'AGENT_FROZEN', actor: 'admin@company.com', target: 'Expense Manager', severity: 'WARNING', timestamp: new Date(Date.now() - 600000), details: 'Agent frozen due to suspicious activity' },
  { id: '3', action: 'DELEGATION_CREATED', actor: 'Shopping Assistant', target: 'Sub-Agent A', severity: 'INFO', timestamp: new Date(Date.now() - 900000), details: 'New delegation created with $500 limit' },
  { id: '4', action: 'TRANSACTION_DENIED', actor: 'Travel Planner', target: 'tx_xyz789', severity: 'WARNING', timestamp: new Date(Date.now() - 1200000), details: 'Transaction denied: exceeded spending limit' },
  { id: '5', action: 'POLICY_UPDATED', actor: 'admin@company.com', target: 'Max Transaction Limit', severity: 'INFO', timestamp: new Date(Date.now() - 1500000), details: 'Policy limit updated from $500 to $1000' },
  { id: '6', action: 'GLOBAL_FREEZE_ACTIVATED', actor: 'admin@company.com', target: 'system', severity: 'CRITICAL', timestamp: new Date(Date.now() - 3600000), details: 'Global freeze activated: security incident' },
];

export default function AuditPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');

  const filteredLogs = mockAuditLogs.filter((log) => {
    const matchesSearch = log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSeverity = severityFilter === 'all' || log.severity === severityFilter;
    const matchesAction = actionFilter === 'all' || log.action.includes(actionFilter);
    return matchesSearch && matchesSeverity && matchesAction;
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'WARNING': return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      default: return <CheckCircle className="h-4 w-4 text-green-600" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-100 text-red-600';
      case 'WARNING': return 'bg-yellow-100 text-yellow-600';
      default: return 'bg-green-100 text-green-600';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground">Immutable record of all system events</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-muted">
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search audit logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md bg-background"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background"
        >
          <option value="all">All Severity</option>
          <option value="INFO">Info</option>
          <option value="WARNING">Warning</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background"
        >
          <option value="all">All Actions</option>
          <option value="TRANSACTION">Transactions</option>
          <option value="AGENT">Agents</option>
          <option value="DELEGATION">Delegations</option>
          <option value="POLICY">Policies</option>
          <option value="GLOBAL">Global Events</option>
        </select>
      </div>

      {/* Merkle Chain Verification */}
      <div className="bg-card rounded-lg border p-4 flex items-center gap-4">
        <Shield className="h-8 w-8 text-green-600" />
        <div>
          <p className="font-medium">Audit Chain Verified</p>
          <p className="text-sm text-muted-foreground">All {mockAuditLogs.length} entries have valid Merkle proofs</p>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="space-y-3">
        {filteredLogs.map((log) => (
          <div key={log.id} className="bg-card rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                {getSeverityIcon(log.severity)}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{log.action}</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', getSeverityColor(log.severity))}>
                      {log.severity}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{log.details}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Actor: {log.actor}</span>
                    <span>Target: {log.target}</span>
                  </div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(log.timestamp)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
