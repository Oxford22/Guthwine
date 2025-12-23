/**
 * WebSocket Hook for Real-time Updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export type WebSocketMessage = {
  type: string;
  payload: any;
  timestamp: string;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket({
  url,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  reconnect = true,
  reconnectInterval = 3000,
  maxReconnectAttempts = 10,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    
    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
          onMessage?.(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      wsRef.current.onclose = () => {
        setStatus('disconnected');
        onDisconnect?.();

        if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, reconnectInterval);
        }
      };

      wsRef.current.onerror = (error) => {
        setStatus('error');
        onError?.(error);
      };
    } catch (e) {
      setStatus('error');
    }
  }, [url, onMessage, onConnect, onDisconnect, onError, reconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    status,
    lastMessage,
    send,
    connect,
    disconnect,
  };
}

// Event types for Guthwine real-time updates
export type GuthwineEventType = 
  | 'transaction.created'
  | 'transaction.approved'
  | 'transaction.denied'
  | 'agent.created'
  | 'agent.frozen'
  | 'agent.unfrozen'
  | 'policy.created'
  | 'policy.updated'
  | 'delegation.created'
  | 'delegation.revoked'
  | 'alert.fired'
  | 'alert.resolved';

export interface GuthwineEvent {
  type: GuthwineEventType;
  organizationId: string;
  payload: any;
  timestamp: string;
}

export function useGuthwineEvents(organizationId: string) {
  const [events, setEvents] = useState<GuthwineEvent[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    const event = message as unknown as GuthwineEvent;
    
    // Filter by organization
    if (event.organizationId !== organizationId) return;

    setEvents(prev => [event, ...prev].slice(0, 100));

    switch (event.type) {
      case 'transaction.created':
      case 'transaction.approved':
      case 'transaction.denied':
        setTransactions(prev => {
          const idx = prev.findIndex(t => t.id === event.payload.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = event.payload;
            return updated;
          }
          return [event.payload, ...prev].slice(0, 50);
        });
        break;

      case 'alert.fired':
        setAlerts(prev => [event.payload, ...prev].slice(0, 20));
        break;

      case 'alert.resolved':
        setAlerts(prev => prev.filter(a => a.id !== event.payload.id));
        break;
    }
  }, [organizationId]);

  const apiUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || 'http://localhost:3000';
  const wsUrl = apiUrl.replace('http', 'ws') + '/ws';

  const { status, send } = useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    onConnect: () => {
      // Subscribe to organization events
      send({ type: 'subscribe', organizationId });
    },
  });

  return {
    status,
    events,
    transactions,
    alerts,
    send,
  };
}
