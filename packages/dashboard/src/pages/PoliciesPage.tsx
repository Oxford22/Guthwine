import { useState } from 'react';
import { Shield, Plus, Search, Edit, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const mockPolicies = [
  { id: '1', name: 'Max Transaction Limit', type: 'SPENDING', action: 'DENY', priority: 100, isActive: true, description: 'Block transactions over $1000' },
  { id: '2', name: 'Business Hours Only', type: 'TEMPORAL', action: 'DENY', priority: 90, isActive: true, description: 'Only allow transactions during business hours' },
  { id: '3', name: 'Blocked Merchants', type: 'VENDOR', action: 'DENY', priority: 95, isActive: true, description: 'Block gambling and adult content merchants' },
  { id: '4', name: 'High Risk Review', type: 'SEMANTIC', action: 'FLAG', priority: 80, isActive: true, description: 'Flag transactions with suspicious reasoning' },
  { id: '5', name: 'Rate Limit', type: 'RATE_LIMIT', action: 'DENY', priority: 85, isActive: false, description: 'Max 10 transactions per hour' },
];

export default function PoliciesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const filteredPolicies = mockPolicies.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || p.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Policies</h1>
          <p className="text-muted-foreground">Configure authorization rules and constraints</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
          <Plus className="h-4 w-4" />
          Create Policy
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search policies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md bg-background"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background"
        >
          <option value="all">All Types</option>
          <option value="SPENDING">Spending</option>
          <option value="TEMPORAL">Temporal</option>
          <option value="VENDOR">Vendor</option>
          <option value="SEMANTIC">Semantic</option>
          <option value="RATE_LIMIT">Rate Limit</option>
          <option value="GEOGRAPHIC">Geographic</option>
        </select>
      </div>

      <div className="grid gap-4">
        {filteredPolicies.map((policy) => (
          <div key={policy.id} className={cn('bg-card rounded-lg border p-6', !policy.isActive && 'opacity-60')}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-muted">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{policy.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{policy.type}</span>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      policy.action === 'DENY' ? 'bg-red-100 text-red-600' :
                      policy.action === 'FLAG' ? 'bg-yellow-100 text-yellow-600' :
                      'bg-green-100 text-green-600'
                    )}>
                      {policy.action}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{policy.description}</p>
                  <p className="text-xs text-muted-foreground mt-2">Priority: {policy.priority}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 hover:bg-muted rounded-md">
                  {policy.isActive ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5" />}
                </button>
                <button className="p-2 hover:bg-muted rounded-md">
                  <Edit className="h-4 w-4" />
                </button>
                <button className="p-2 hover:bg-muted rounded-md text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
