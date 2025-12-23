import { useState } from 'react';
import { ArrowLeftRight, Search, Eye, FileText } from 'lucide-react';
import { cn, formatCurrency, formatDate, getStatusColor, getRiskColor } from '@/lib/utils';

const mockTransactions = [
  { id: '1', agent: 'Shopping Assistant', amount: 125.99, currency: 'USD', merchant: 'Amazon', status: 'APPROVED', riskScore: 15, createdAt: new Date(Date.now() - 300000) },
  { id: '2', agent: 'Travel Planner', amount: 450.00, currency: 'USD', merchant: 'Expedia', status: 'DENIED', riskScore: 78, createdAt: new Date(Date.now() - 600000) },
  { id: '3', agent: 'Expense Manager', amount: 89.50, currency: 'USD', merchant: 'Office Depot', status: 'APPROVED', riskScore: 22, createdAt: new Date(Date.now() - 900000) },
  { id: '4', agent: 'Shopping Assistant', amount: 299.99, currency: 'USD', merchant: 'Best Buy', status: 'EXECUTED', riskScore: 35, createdAt: new Date(Date.now() - 1200000) },
  { id: '5', agent: 'Subscription Bot', amount: 14.99, currency: 'USD', merchant: 'Netflix', status: 'APPROVED', riskScore: 5, createdAt: new Date(Date.now() - 1500000) },
];

export default function TransactionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredTransactions = mockTransactions.filter((tx) => {
    const matchesSearch = tx.agent.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.merchant.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || tx.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transactions</h1>
        <p className="text-muted-foreground">View and manage transaction requests</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search transactions..."
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
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="DENIED">Denied</option>
          <option value="EXECUTED">Executed</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium">Transaction</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Agent</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Merchant</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Amount</th>
              <th className="text-center px-4 py-3 text-sm font-medium">Risk</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium">Time</th>
              <th className="text-right px-4 py-3 text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.map((tx) => (
              <tr key={tx.id} className="border-t hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-sm">#{tx.id}</td>
                <td className="px-4 py-3 text-sm">{tx.agent}</td>
                <td className="px-4 py-3 text-sm">{tx.merchant}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">
                  {formatCurrency(tx.amount, tx.currency)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={cn('font-medium', getRiskColor(tx.riskScore))}>
                    {tx.riskScore}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-1 rounded-full', getStatusColor(tx.status))}>
                    {tx.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {formatDate(tx.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-2 hover:bg-muted rounded-md" title="View Details">
                      <Eye className="h-4 w-4" />
                    </button>
                    <button className="p-2 hover:bg-muted rounded-md" title="View Explanation">
                      <FileText className="h-4 w-4" />
                    </button>
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
