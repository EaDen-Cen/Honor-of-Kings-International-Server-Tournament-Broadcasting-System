import { useEffect, useRef, useState } from 'react';
import type { Action, Role, Snapshot } from './types';
const api = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const wsURL = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
export function useMatch(role: Role, token: string, onToken?: (token:string)=>void) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [status, setStatus] = useState('Connecting');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState<{ id: string; action: Action }>();
  const latestSnapshot = useRef<Snapshot>();
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const pendingAction = useRef<Action>();
  const socket = useRef<WebSocket>();
  const pendingID = useRef<string>();
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let active: WebSocket | undefined;
    let attempts = 0;
    let abort: AbortController;
    latestSnapshot.current = undefined;
    socket.current = undefined;
    pendingAction.current = undefined;
    pendingID.current = undefined;
    clearTimeout(pendingTimer.current);
    setPending(false); setError('');
    setSnapshot(undefined); setAcknowledged(undefined);
    function clearPending() { pendingAction.current = undefined; pendingID.current = undefined; clearTimeout(pendingTimer.current); setPending(false); }
    async function connect() {
      if (stopped || !token) { setStatus('Access token required'); return; }
      setStatus('Connecting');
      const requestAbort = new AbortController();
      abort = requestAbort;
      const timeout = setTimeout(() => requestAbort.abort(), 8000);
      try {
        const response = await fetch(`${api}/api/match`, { headers: { Authorization: `Bearer ${token}` }, signal: requestAbort.signal, cache: 'no-store' });
        if (response.status === 401) { setStatus('Invalid token'); return; }
        if (!response.ok) throw new Error('暂时无法连接服务器');
        const initial: Snapshot = await response.json();
        if (stopped) return;
        latestSnapshot.current = initial;
        setSnapshot(initial);
        const ws = new WebSocket(wsURL); active = ws; socket.current = ws;
        let lastReceived = Date.now();
        let authenticated = false;
        const heartbeat = setInterval(() => {
          if (Date.now() - lastReceived > 20000) ws.close();
          else if (authenticated && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 5000);
        const connectTimeout = setTimeout(() => ws.close(), 8000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
        ws.onmessage = event => {
          if (stopped) return;
          lastReceived = Date.now();
          let msg;
          try { msg = JSON.parse(event.data); } catch { ws.close(); return; }
          if (!msg || typeof msg !== 'object') { ws.close(); return; }
          if (msg.type === 'match_state_update') { authenticated = true; clearTimeout(connectTimeout); attempts = 0; latestSnapshot.current = msg; setSnapshot(msg); setStatus('Connected'); }
          else if (msg.type === 'access_token_update') onTokenRef.current?.(msg.token);
          else if (msg.type === 'error') { setError(typeof msg.error === 'string' ? msg.error : '消息格式无效，请重新连接后重试'); if (msg.id && msg.id === pendingID.current) clearPending(); }
          else if (msg.type === 'ack' && msg.id === pendingID.current) {
            if (pendingAction.current) setAcknowledged({ id: msg.id, action: pendingAction.current });
            clearPending();
          }
        };
        ws.onclose = event => {
          clearInterval(heartbeat);
          clearTimeout(connectTimeout);
          if (stopped) return;
          if (pendingID.current) setError('连接已断开，正在重新加载比赛状态。请确认当前选禁结果后再重试。');
          clearPending(); setStatus(event.code === 1008 ? 'Access rejected' : 'Reconnecting');
          if (event.code !== 1008) schedule();
        };
        ws.onerror = () => ws.close();
      } catch { if (!stopped) { setStatus('Reconnecting'); schedule(); } }
      finally { clearTimeout(timeout); }
    }
    function schedule() { timer = setTimeout(connect, Math.min(10000, 500 * 2 ** attempts++) + Math.random() * 300); }
    void connect();
    return () => { stopped = true; clearTimeout(timer); clearTimeout(pendingTimer.current); abort?.abort(); active?.close(); pendingID.current = undefined; pendingAction.current = undefined; socket.current = undefined; setPending(false); };
  }, [role, token]);
  function send(action: Action) {
    if (role !== 'control' || status !== 'Connected' || !latestSnapshot.current || pendingID.current || socket.current?.readyState !== WebSocket.OPEN) return;
    setError(''); const id = crypto.randomUUID(); pendingID.current = id; pendingAction.current = action; setPending(true);
    try {
      socket.current.send(JSON.stringify({ type: 'action', id, revision: latestSnapshot.current.revision, action }));
    } catch {
      pendingID.current = undefined; pendingAction.current = undefined; setPending(false);
      setError('连接已断开，正在重新加载比赛状态。请确认当前选禁结果后再重试。');
      socket.current.close();
      return;
    }
    pendingTimer.current = setTimeout(() => {
      pendingID.current = undefined; pendingAction.current = undefined; setPending(false);
      setStatus('Reconnecting');
      setError('操作确认超时，正在重新加载比赛状态。请确认结果后再重试。');
      socket.current?.close();
    }, 8000);
  }
  return { snapshot, status, error, pending, send, acknowledged };
}
