import { useState } from 'react';
import { GitBranch, Plus, Search, Eye, XCircle, AlertTriangle } from 'lucide-react';
import { cn, truncateDid, formatDate, getStatusColor, formatCurrency } from '@/lib/utils';

const mockDelegations = [
  { id: '1', issuer: 'Shopping Assistant', recipient: 'Sub-Agent A', status: 'ACTIVE', depth: 1, maxAmount: 500, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  { id: '2', issuer: 'Shopping Assistant', recipient: 'Sub-Agent B', status: 'ACTIVE', depth: 1, maxAmount: 250, expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
  { id: '3', issuer: 'Travel Planner', recipient: 'Booking Agent', status: 'REVOKED', depth: 1, maxAmount: 1000, expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
  { id: '4', issuer: 'Sub-Agent A', recipient: 'Micro-Agent', status: 'ACTIVE', depth: 2, maxAmount: 100, expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000) },
];

export default function DelegationsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filteredDelegations = mockDelegations.filter((d) => {
    const matchesSearch = d.issuer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.recipient.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Delegations</h1>
          <p className="text-muted-foreground">Manage agent delegation chains</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create Delegation
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search delegations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md bg-background"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background"
        >
          <option value="all">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="REVOKED">Revoked</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {/* Delegation Tree Visualization Placeholder */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          Delegation Tree
        </h3>
        <div className="h-64 flex items-center justify-center bg-muted/30 rounded-lg">
          <p className="text-muted-foreground">Interactive delegation tree visualization</p>
        </div>
      </div>

      {/* Delegations Table */}
      <div className="bg-card rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium">Issuer</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Recipient</th>
              <th className="text-center px-4 py-3 text-sm font-medium">Depth</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Max Amount</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Expires</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDelegations.map((d) => (
              <tr key={d.id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-3 text-sm font-medium">{d.issuer}</td>
                <td className="px-4 py-3 text-sm">{d.recipient}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-xs px-2 py-1 rounded-full bg-muted">{d.depth}</span>
                </td>
                <td className="px-4 py-3 text-sm text-right">{formatCurrency(d.maxAmount)}</td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-1 rounded-full', getStatusColor(d.status))}>
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {formatDate(d.expiresAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-2 hover:bg-muted rounded-md" title="View Details">
                      <Eye className="h-4 w-4" />
                    </button>
                    {d.status === 'ACTIVE' && (
                      <button className="p-2 hover:bg-muted rounded-md text-destructive" title="Revoke">
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
