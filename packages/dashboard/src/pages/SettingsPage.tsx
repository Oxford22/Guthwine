import { useState } from 'react';
import { Settings, AlertTriangle, Shield, Bell, Key, Users, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGlobalFreezeStore } from '@/lib/store';

export default function SettingsPage() {
  const { isActive: globalFreezeActive, setGlobalFreeze } = useGlobalFreezeStore();
  const [freezeReason, setFreezeReason] = useState('');

  const handleGlobalFreeze = () => {
    if (globalFreezeActive) {
      setGlobalFreeze(false);
    } else {
      if (freezeReason.trim()) {
        setGlobalFreeze(true, freezeReason);
        setFreezeReason('');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure system settings and preferences</p>
      </div>

      {/* Global Freeze Control */}
      <div className={cn(
        'rounded-lg border p-6',
        globalFreezeActive ? 'bg-red-50 border-red-200' : 'bg-card'
      )}>
        <div className="flex items-start gap-4">
          <div className={cn('p-3 rounded-lg', globalFreezeActive ? 'bg-red-100' : 'bg-muted')}>
            <AlertTriangle className={cn('h-6 w-6', globalFreezeActive ? 'text-red-600' : 'text-muted-foreground')} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">Global Freeze (Kill Switch)</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {globalFreezeActive 
                ? 'All transactions are currently blocked. Deactivate to resume normal operations.'
                : 'Immediately halt all agent transactions across the entire organization.'}
            </p>
            {!globalFreezeActive && (
              <input
                type="text"
                placeholder="Reason for freeze (required)"
                value={freezeReason}
                onChange={(e) => setFreezeReason(e.target.value)}
                className="mt-4 w-full px-3 py-2 border rounded-md bg-background"
              />
            )}
            <button
              onClick={handleGlobalFreeze}
              disabled={!globalFreezeActive && !freezeReason.trim()}
              className={cn(
                'mt-4 px-4 py-2 rounded-md font-medium',
                globalFreezeActive 
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50'
              )}
            >
              {globalFreezeActive ? 'Deactivate Global Freeze' : 'Activate Global Freeze'}
            </button>
          </div>
        </div>
      </div>

      {/* Settings Sections */}
      <div className="grid gap-6">
        {/* Security Settings */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Shield className="h-5 w-5" />
            Security Settings
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Two-Factor Authentication</p>
                <p className="text-sm text-muted-foreground">Require 2FA for all admin actions</p>
              </div>
              <button className="px-4 py-2 border rounded-md hover:bg-muted">Configure</button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Session Timeout</p>
                <p className="text-sm text-muted-foreground">Auto-logout after inactivity</p>
              </div>
              <select className="px-4 py-2 border rounded-md bg-background">
                <option>15 minutes</option>
                <option>30 minutes</option>
                <option>1 hour</option>
                <option>4 hours</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5" />
            Notifications
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">High Risk Transactions</p>
                <p className="text-sm text-muted-foreground">Alert when risk score exceeds threshold</p>
              </div>
              <input type="checkbox" defaultChecked className="h-5 w-5" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Agent Freeze Events</p>
                <p className="text-sm text-muted-foreground">Notify when agents are frozen</p>
              </div>
              <input type="checkbox" defaultChecked className="h-5 w-5" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Delegation Expirations</p>
                <p className="text-sm text-muted-foreground">Warn before delegations expire</p>
              </div>
              <input type="checkbox" defaultChecked className="h-5 w-5" />
            </div>
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Key className="h-5 w-5" />
            API Keys
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="font-mono text-sm">gw_live_****************************abc123</p>
                <p className="text-xs text-muted-foreground">Created Dec 1, 2024 • Last used 2 hours ago</p>
              </div>
              <button className="text-sm text-destructive hover:underline">Revoke</button>
            </div>
            <button className="px-4 py-2 border rounded-md hover:bg-muted">Generate New API Key</button>
          </div>
        </div>

        {/* Organization */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Users className="h-5 w-5" />
            Organization
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Organization Name</label>
              <input
                type="text"
                defaultValue="Acme Corporation"
                className="w-full px-3 py-2 border rounded-md bg-background"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Billing Email</label>
              <input
                type="email"
                defaultValue="billing@acme.com"
                className="w-full px-3 py-2 border rounded-md bg-background"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
