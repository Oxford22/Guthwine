import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { login } from '@/lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login: setAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);
      if (result.success) {
        setAuth(result.user, result.sessionToken);
        navigate('/');
      }
    } catch (err) {
      setError((err as Error).message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  // Demo login for testing
  const handleDemoLogin = () => {
    setAuth(
      {
        id: 'demo-user',
        email: 'demo@guthwine.io',
        name: 'Demo User',
        role: 'ADMIN',
        organizationId: 'demo-org',
      },
      'demo-token'
    );
    navigate('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="h-16 w-16 rounded-xl bg-primary flex items-center justify-center mb-4">
              <Shield className="h-10 w-10 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold">Guthwine</h1>
            <p className="text-muted-foreground text-sm">
              Sovereign Governance Layer
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="you@company.com"
                required
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </button>
          </form>

          <div className="mt-6 pt-6 border-t">
            <button
              onClick={handleDemoLogin}
              className="w-full py-2 px-4 border rounded-md text-sm font-medium hover:bg-muted transition-colors"
            >
              Continue with Demo Account
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          AI Agent Authorization & Governance
        </p>
      </div>
    </div>
  );
}
