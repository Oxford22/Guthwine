import { GuthwineClient } from '@guthwine/sdk';
import { useAuthStore } from './store';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '/api';

export function getClient(): GuthwineClient {
  const token = useAuthStore.getState().token;
  if (!token) {
    throw new Error('Not authenticated');
  }
  return new GuthwineClient({
    baseUrl: API_BASE_URL,
    sessionToken: token,
  });
}

// Direct fetch for endpoints not in SDK
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token;
  
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth endpoints
export async function login(email: string, password: string) {
  return apiFetch<{
    success: boolean;
    sessionToken: string;
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      organizationId: string;
    };
  }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return apiFetch('/v1/auth/logout', { method: 'POST' });
}
