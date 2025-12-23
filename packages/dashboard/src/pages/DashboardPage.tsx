import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  ArrowLeftRight,
  GitBranch,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
} from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn, formatCurrency, formatRelativeTime, getStatusColor } from '@/lib/utils';
import { getClient } from '@/lib/api';

// Mock data for demo
const mockTransactionData = [
  { date: 'Mon', approved: 45, denied: 5, volume: 12500 },
  { date: 'Tue', approved: 52, denied: 8, volume: 15200 },
  { date: 'Wed', approved: 38, denied: 3, volume: 9800 },
  { date: 'Thu', approved: 65, denied: 12, volume: 18900 },
  { date: 'Fri', approved: 48, denied: 6, volume: 14300 },
  { date: 'Sat', approved: 25, denied: 2, volume: 6500 },
  { date: 'Sun', approved: 18, denied: 1, volume: 4200 },
];

const mockRiskDistribution = [
  { name: 'Low Risk', value: 65, color: '#22c55e' },
  { name: 'Medium Risk', value: 25, color: '#eab308' },
  { name: 'High Risk', value: 10, color: '#ef4444' },
];

const mockRecentTransactions = [
  { id: '1', agent: 'Shopping Assistant', amount: 125.99, status: 'APPROVED', time: new Date(Date.now() - 300000) },
  { id: '2', agent: 'Travel Planner', amount: 450.00, status: 'DENIED', time: new Date(Date.now() - 600000) },
  { id: '3', agent: 'Expense Manager', amount: 89.50, status: 'APPROVED', time: new Date(Date.now() - 900000) },
  { id: '4', agent: 'Shopping Assistant', amount: 299.99, status: 'APPROVED', time: new Date(Date.now() - 1200000) },
  { id: '5', agent: 'Subscription Bot', amount: 14.99, status: 'APPROVED', time: new Date(Date.now() - 1500000) },
];

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ElementType;
  iconColor?: string;
}

function StatCard({ title, value, change, icon: Icon, iconColor = 'text-primary' }: StatCardProps) {
  return (
    <div className="bg-card rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {change !== undefined && (
            <div className={cn(
              'flex items-center gap-1 text-sm mt-1',
              change >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span>{Math.abs(change)}% from last week</span>
            </div>
          )}
        </div>
        <div className={cn('p-3 rounded-lg bg-muted', iconColor)}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  // In production, these would fetch from the API
  const stats = {
    activeAgents: 24,
    agentChange: 12,
    todayTransactions: 156,
    transactionChange: 8,
    activeDelegations: 42,
    delegationChange: -5,
    alertsCount: 3,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your AI agent governance system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Agents"
          value={stats.activeAgents}
          change={stats.agentChange}
          icon={Bot}
          iconColor="text-blue-600"
        />
        <StatCard
          title="Today's Transactions"
          value={stats.todayTransactions}
          change={stats.transactionChange}
          icon={ArrowLeftRight}
          iconColor="text-green-600"
        />
        <StatCard
          title="Active Delegations"
          value={stats.activeDelegations}
          change={stats.delegationChange}
          icon={GitBranch}
          iconColor="text-purple-600"
        />
        <StatCard
          title="Alerts"
          value={stats.alertsCount}
          icon={AlertTriangle}
          iconColor="text-yellow-600"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transaction Volume Chart */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">Transaction Volume</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockTransactionData}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorVolume)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Approval Rate Chart */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">Approval Rate</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockTransactionData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Bar dataKey="approved" fill="#22c55e" name="Approved" radius={[4, 4, 0, 0]} />
                <Bar dataKey="denied" fill="#ef4444" name="Denied" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">Risk Distribution</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mockRiskDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {mockRiskDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {mockRiskDistribution.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-sm">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-card rounded-lg border p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Transactions</h3>
            <a
              href="/transactions"
              className="text-sm text-primary hover:underline"
            >
              View all
            </a>
          </div>
          <div className="space-y-3">
            {mockRecentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <Bot className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{tx.agent}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeTime(tx.time)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatCurrency(tx.amount)}</p>
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      getStatusColor(tx.status)
                    )}
                  >
                    {tx.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* System Health */}
      <div className="bg-card rounded-lg border p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-green-600" />
          <h3 className="font-semibold">System Health</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600">
            All Systems Operational
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'API Server', status: 'Healthy', latency: '12ms' },
            { name: 'Database', status: 'Healthy', latency: '3ms' },
            { name: 'Redis Cache', status: 'Healthy', latency: '1ms' },
            { name: 'Policy Engine', status: 'Healthy', latency: '45ms' },
          ].map((service) => (
            <div key={service.name} className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium">{service.name}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {service.latency} avg
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
