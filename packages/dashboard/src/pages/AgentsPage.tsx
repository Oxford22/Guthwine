import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bot,
  Plus,
  Search,
  MoreVertical,
  Snowflake,
  Play,
  Trash2,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { cn, truncateDid, getStatusColor, formatDate } from '@/lib/utils';
import { getClient } from '@/lib/api';

// Mock data for demo
const mockAgents = [
  {
    id: '1',
    name: 'Shopping Assistant',
    did: 'did:guthwine:agent:abc123def456',
    type: 'PRIMARY',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    transactionCount: 156,
    delegationCount: 3,
  },
  {
    id: '2',
    name: 'Travel Planner',
    did: 'did:guthwine:agent:xyz789ghi012',
    type: 'DELEGATED',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    transactionCount: 42,
    delegationCount: 1,
  },
  {
    id: '3',
    name: 'Expense Manager',
    did: 'did:guthwine:agent:mno345pqr678',
    type: 'PRIMARY',
    status: 'FROZEN',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    transactionCount: 89,
    delegationCount: 0,
  },
  {
    id: '4',
    name: 'Subscription Bot',
    did: 'did:guthwine:agent:stu901vwx234',
    type: 'SERVICE',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    transactionCount: 12,
    delegationCount: 0,
  },
];

export default function AgentsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filteredAgents = mockAgents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.did.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;
    const matchesType = typeFilter === 'all' || agent.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-muted-foreground">
            Manage your AI agents and their permissions
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create Agent
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="FROZEN">Frozen</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Types</option>
          <option value="PRIMARY">Primary</option>
          <option value="DELEGATED">Delegated</option>
          <option value="SERVICE">Service</option>
          <option value="EPHEMERAL">Ephemeral</option>
        </select>
      </div>

      {/* Agents Table */}
      <div className="bg-card rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium">Agent</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Transactions</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Delegations</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Created</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAgents.map((agent) => (
              <tr key={agent.id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <Link
                        to={`/agents/${agent.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {agent.name}
                      </Link>
                      <p className="text-xs text-muted-foreground font-mono">
                        {truncateDid(agent.did)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm">{agent.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'text-xs px-2 py-1 rounded-full',
                      getStatusColor(agent.status)
                    )}
                  >
                    {agent.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">{agent.transactionCount}</td>
                <td className="px-4 py-3 text-sm">{agent.delegationCount}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {formatDate(agent.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      to={`/agents/${agent.id}`}
                      className="p-2 hover:bg-muted rounded-md"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                    {agent.status === 'ACTIVE' ? (
                      <button
                        className="p-2 hover:bg-muted rounded-md text-blue-600"
                        title="Freeze Agent"
                      >
                        <Snowflake className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        className="p-2 hover:bg-muted rounded-md text-green-600"
                        title="Unfreeze Agent"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      className="p-2 hover:bg-muted rounded-md text-destructive"
                      title="Delete Agent"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredAgents.length === 0 && (
          <div className="text-center py-12">
            <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No agents found</p>
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Create New Agent</h2>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="My Agent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="PRIMARY">Primary</option>
                  <option value="DELEGATED">Delegated</option>
                  <option value="SERVICE">Service</option>
                  <option value="EPHEMERAL">Ephemeral</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border rounded-md hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
