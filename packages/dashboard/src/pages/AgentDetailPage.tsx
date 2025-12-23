import { useParams } from 'react-router-dom';
import { Bot, ArrowLeft, Snowflake, Play, GitBranch, ArrowLeftRight, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn, truncateDid, getStatusColor, formatCurrency, formatDate } from '@/lib/utils';

export default function AgentDetailPage() {
  const { id } = useParams();

  // Mock data
  const agent = {
    id,
    name: 'Shopping Assistant',
    did: 'did:guthwine:agent:abc123def456789xyz',
    type: 'PRIMARY',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    capabilities: { canDelegate: true, canTransact: true, maxDelegationDepth: 3 },
    spendingLimits: { maxPerTransaction: 1000, maxDaily: 5000, maxWeekly: 20000 },
    stats: {
      totalTransactions: 156,
      approvedTransactions: 148,
      deniedTransactions: 8,
      totalVolume: 15234.56,
      activeDelegations: 3,
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/agents" className="p-2 hover:bg-muted rounded-md">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="text-muted-foreground font-mono text-sm">
            {truncateDid(agent.did, 40)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === 'ACTIVE' ? (
            <button className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-muted text-blue-600">
              <Snowflake className="h-4 w-4" />
              Freeze
            </button>
          ) : (
            <button className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-muted text-green-600">
              <Play className="h-4 w-4" />
              Unfreeze
            </button>
          )}
        </div>
      </div>

      {/* Status and Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Bot className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <span className={cn('text-sm px-2 py-1 rounded-full', getStatusColor(agent.status))}>
                {agent.status}
              </span>
              <p className="text-sm text-muted-foreground mt-1">{agent.type}</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(agent.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Can Delegate</span>
              <span>{agent.capabilities.canDelegate ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Delegation Depth</span>
              <span>{agent.capabilities.maxDelegationDepth}</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            Transaction Stats
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-2xl font-bold">{agent.stats.totalTransactions}</p>
              <p className="text-sm text-muted-foreground">Total Transactions</p>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-lg font-semibold text-green-600">{agent.stats.approvedTransactions}</p>
                <p className="text-xs text-muted-foreground">Approved</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-red-600">{agent.stats.deniedTransactions}</p>
                <p className="text-xs text-muted-foreground">Denied</p>
              </div>
            </div>
            <div>
              <p className="text-lg font-semibold">{formatCurrency(agent.stats.totalVolume)}</p>
              <p className="text-xs text-muted-foreground">Total Volume</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Spending Limits
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Per Transaction</span>
              <span className="font-medium">{formatCurrency(agent.spendingLimits.maxPerTransaction)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily</span>
              <span className="font-medium">{formatCurrency(agent.spendingLimits.maxDaily)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Weekly</span>
              <span className="font-medium">{formatCurrency(agent.spendingLimits.maxWeekly)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Delegations */}
      <div className="bg-card rounded-lg border p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          Active Delegations ({agent.stats.activeDelegations})
        </h3>
        <p className="text-muted-foreground text-sm">
          View and manage delegations in the Delegations page.
        </p>
        <Link to="/delegations" className="text-primary text-sm hover:underline mt-2 inline-block">
          View Delegations →
        </Link>
      </div>
    </div>
  );
}
