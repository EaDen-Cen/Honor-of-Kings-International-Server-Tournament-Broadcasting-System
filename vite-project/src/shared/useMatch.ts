import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, Role, Snapshot } from './types';
import { createMatchActionId, isMatchSnapshot, parseMatchMessage } from './matchProtocol';

const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const wsURL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const disconnectedMessage = '连接已断开，正在重新加载比赛状态。请确认当前选禁结果后再重试。';
const invalidMessage = '消息格式无效，请重新连接后重试';
interface Session {
  role: Role;
  token: string;
  stopped: boolean;
  ready: boolean;
  socket?: WebSocket;
  snapshot?: Snapshot;
  pending?: { id: string; action: Action; timer: ReturnType<typeof setTimeout> };
  recover?: (message?: string) => void;
}
function cancelPending(session: Session) {
  clearTimeout(session.pending?.timer);
  session.pending = undefined;
}

export function useMatch(role: Role, token: string, onToken?: (token: string) => void) {
  const [scope, setScope] = useState({ role, token });
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [status, setStatus] = useState('Connecting');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState<{ id: string; action: Action }>();
  const sessionRef = useRef<Session>();
  const desiredScope = useRef({ role, token });
  desiredScope.current = { role, token };
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    const session: Session = { role, token, stopped: false, ready: false };
    sessionRef.current = session;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let abort: AbortController | undefined;
    let disposeSocket: (() => void) | undefined;
    const currentSession = () => !session.stopped && sessionRef.current === session && desiredScope.current.role === role && desiredScope.current.token === token;
    setScope({ role, token });
    setPending(false); setError(''); setSnapshot(undefined); setAcknowledged(undefined);

    function schedule() {
      if (!currentSession()) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void connect(); }, Math.min(10000, 500 * 2 ** attempts++) + Math.random() * 300);
    }
    async function connect() {
      if (!currentSession()) return;
      if (!token) { setStatus('Access token required'); return; }
      session.ready = false;
      setStatus('Connecting');
      const requestAbort = new AbortController();
      abort = requestAbort;
      const timeout = setTimeout(() => requestAbort.abort(), 8000);
      try {
        const response = await fetch(`${api}/api/match`, { headers: { Authorization: `Bearer ${token}` }, signal: requestAbort.signal, cache: 'no-store' });
        if (!currentSession()) return;
        if (response.status === 401) { session.snapshot = undefined; setSnapshot(undefined); setStatus('Invalid token'); return; }
        if (!response.ok) throw new Error('暂时无法连接服务器');
        const initial: unknown = await response.json();
        if (!currentSession()) return;
        if (!isMatchSnapshot(initial)) { setError(invalidMessage); throw new Error(invalidMessage); }
        session.snapshot = initial;
        setSnapshot(initial);
        const ws = new WebSocket(wsURL);
        session.socket = ws;
        let lastReceived = Date.now();
        let authenticated = false;
        const currentSocket = () => currentSession() && session.socket === ws;
        const heartbeat = setInterval(() => {
          if (!currentSocket()) return;
          if (Date.now() - lastReceived > 20000) recover();
          else if (authenticated && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch { recover(); }
          }
        }, 5000);
        const connectTimeout = setTimeout(() => recover(), 8000);
        function dispose() {
          clearInterval(heartbeat); clearTimeout(connectTimeout);
          if (ws.readyState !== WebSocket.CLOSED) ws.close();
        }
        function disconnect(code: number, message?: string) {
          if (!currentSocket()) return;
          // Disable sends synchronously. A React render can lag behind a close,
          // timeout or malformed message, and old sockets can still queue events.
          session.ready = false; session.socket = undefined; session.recover = undefined;
          if (message || session.pending) setError(message || disconnectedMessage);
          cancelPending(session); setPending(false); setAcknowledged(undefined);
          dispose();
          setStatus(code === 1008 ? 'Access rejected' : 'Reconnecting');
          if (code !== 1008) schedule();
        }
        function recover(message?: string) { disconnect(1006, message); }
        disposeSocket = dispose;
        session.recover = recover;
        ws.onopen = () => {
          if (!currentSocket()) return;
          try { ws.send(JSON.stringify({ type: 'auth', token })); } catch { recover(); }
        };
        ws.onmessage = event => {
          if (!currentSocket()) return;
          const msg = parseMatchMessage(event.data);
          // Authentication can fail with an error followed by policy close
          // 1008. Keep this socket active until that close reaches us so the
          // rejection stops retries instead of becoming a reconnect loop.
          if (!msg || (!authenticated && msg.type !== 'match_state_update' && msg.type !== 'error')) { recover(invalidMessage); return; }
          lastReceived = Date.now();
          if (msg.type === 'match_state_update') {
            authenticated = true; clearTimeout(connectTimeout); attempts = 0;
            session.ready = true; session.snapshot = msg;
            setSnapshot(msg); setStatus('Connected');
          } else if (msg.type === 'access_token_update') onTokenRef.current?.(msg.token);
          else if (msg.type === 'error') {
            setError(msg.error);
            if (msg.id === session.pending?.id) { cancelPending(session); setPending(false); }
          } else if (msg.type === 'ack' && msg.id === session.pending?.id) {
            setAcknowledged({ id: msg.id, action: session.pending.action });
            cancelPending(session); setPending(false);
          }
        };
        ws.onclose = event => disconnect(event.code);
        ws.onerror = () => recover();
      } catch {
        if (currentSession()) { setStatus('Reconnecting'); schedule(); }
      } finally { clearTimeout(timeout); }
    }
    void connect();
    return () => {
      session.stopped = true; session.ready = false; session.recover = undefined;
      clearTimeout(timer); cancelPending(session); abort?.abort(); disposeSocket?.();
      session.socket = undefined;
      if (sessionRef.current === session) sessionRef.current = undefined;
    };
  }, [role, token]);

  const send = useCallback((action: Action) => {
    const session = sessionRef.current;
    if (role !== 'control' || desiredScope.current.role !== role || desiredScope.current.token !== token || !session || session.role !== role || session.token !== token || session.stopped || !session.ready || !session.snapshot || session.pending || session.socket?.readyState !== WebSocket.OPEN) return false;
    setError(''); setAcknowledged(undefined);
    const id = createMatchActionId();
    const timer = setTimeout(() => {
      if (sessionRef.current !== session || session.stopped || session.pending?.id !== id) return;
      session.recover?.('操作确认超时，正在重新加载比赛状态。请确认结果后再重试。');
    }, 8000);
    session.pending = { id, action, timer };
    setPending(true);
    try { session.socket.send(JSON.stringify({ type: 'action', id, revision: session.snapshot.revision, action })); return true; }
    catch { session.recover?.(disconnectedMessage); return false; }
  }, [role, token]);

  // A role/token change must hide the old session before its effect cleanup runs.
  const sameSession = scope.role === role && scope.token === token;
  return {
    snapshot: sameSession ? snapshot : undefined,
    status: sameSession ? status : 'Connecting',
    error: sameSession ? error : '',
    pending: sameSession && pending,
    send,
    acknowledged: sameSession ? acknowledged : undefined,
  };
}
