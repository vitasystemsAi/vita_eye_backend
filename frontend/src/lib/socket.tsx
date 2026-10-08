'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { refreshSession, SESSION_EXPIRED_EVENT } from './api';

type ConnState = 'connecting' | 'connected' | 'disconnected';

interface SocketState {
  socket: Socket | null;
  state: ConnState;
}

const SocketContext = createContext<SocketState>({ socket: null, state: 'disconnected' });

export function socketUrl(): string {
  return process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
}

/**
 * Cookie-authenticated Socket.IO connection. The access token expires every few minutes; when the
 * server ends the session the client refreshes it over HTTP and reconnects.
 */
export function SocketProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<ConnState>('disconnected');
  const refreshing = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const s = io(socketUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    setSocket(s);
    setState('connecting');

    async function reauth() {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        if (await refreshSession()) s.connect();
        else window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      } finally {
        refreshing.current = false;
      }
    }

    s.on('connect', () => setState('connected'));
    s.on('disconnect', (reason) => {
      setState('disconnected');
      if (reason === 'io server disconnect') void reauth();
    });
    s.on('connect_error', (err) => {
      setState('disconnected');
      if (err.message === 'UNAUTHENTICATED') void reauth();
    });
    s.io.on('reconnect_attempt', () => setState('connecting'));

    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [enabled]);

  return <SocketContext.Provider value={{ socket, state }}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketState {
  return useContext(SocketContext);
}

/** Subscribe to a server event for the lifetime of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}
