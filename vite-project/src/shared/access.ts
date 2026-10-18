import { useCallback, useEffect, useRef, useState } from 'react';
import type { Role } from './types';

export const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const accessTimeout = 8000;

function persistToken(role: Role, token: string) {
  try {
    if (token) sessionStorage.setItem(`hok-${role}`, token);
    else sessionStorage.removeItem(`hok-${role}`);
  } catch { /* Restricted browser storage must not prevent a live login. */ }
}
function savedToken(role: Role) {
  const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
  if (fragment) {
    persistToken(role, fragment);
    history.replaceState(null, '', location.pathname + location.search);
    return fragment;
  }
  try { return sessionStorage.getItem(`hok-${role}`) || ''; }
  catch { return ''; }
}
function accessData(value: unknown): value is { local?: boolean; token?: string; error?: string } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (!('local' in value) || typeof value.local === 'boolean')
    && (!('token' in value) || typeof value.token === 'string')
    && (!('error' in value) || typeof value.error === 'string');
}
interface AccessState {
  role: Role;
  token: string;
  local: boolean;
  checking: boolean;
  accessError: string;
  loggingIn: boolean;
}
const emptyState = (role: Role, token = ''): AccessState => ({ role, token, local: false, checking: true, accessError: '', loggingIn: false });

export function useAccess(role: Role) {
  const [state, setState] = useState(() => emptyState(role, savedToken(role)));
  const roleRef = useRef(role);
  roleRef.current = role;
  const credentialVersion = useRef(0);
  const loginRequest = useRef<AbortController>();
  const alive = useRef(false);
  const saveToken = useCallback((value: string) => {
    if (roleRef.current !== role) return;
    credentialVersion.current++;
    loginRequest.current?.abort(); loginRequest.current = undefined;
    persistToken(role, value);
    setState(previous => ({ ...(previous.role === role ? previous : emptyState(role)), token: value, loggingIn: false, accessError: '' }));
  }, [role]);

  useEffect(() => {
    let active = true;
    alive.current = true;
    setState(previous => previous.role === role ? { ...previous, checking: true, local: false, accessError: '' } : emptyState(role, savedToken(role)));
    const version = credentialVersion.current;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), accessTimeout);
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/access?role=${role}`, { signal: abort.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Access service unavailable. Please try again.');
        const data: unknown = await response.json();
        if (!accessData(data) || typeof data.local !== 'boolean' || (data.local && !data.token?.trim())) throw new Error('Invalid access service response. Please try again.');
        if (!active || abort.signal.aborted || roleRef.current !== role) return;
        setState(previous => ({ ...previous, local: data.local === true }));
        // A late local-access check must not replace a newer manual credential.
        if (data.local && data.token && credentialVersion.current === version) saveToken(data.token);
      } catch (error) {
        if (active && roleRef.current === role) {
          const message = abort.signal.aborted ? 'Access check timed out. Enter your password or token to connect.' : error instanceof Error ? error.message : 'Access service unavailable. Please try again.';
          setState(previous => ({ ...previous, accessError: message }));
        }
      } finally {
        clearTimeout(timeout);
        if (active && roleRef.current === role) setState(previous => ({ ...previous, checking: false }));
      }
    })();
    return () => {
      active = false; alive.current = false;
      clearTimeout(timeout); abort.abort();
      loginRequest.current?.abort(); loginRequest.current = undefined;
    };
  }, [role, saveToken]);

  const login = useCallback(async (password: string) => {
    if (!alive.current || roleRef.current !== role || loginRequest.current) return;
    const abort = new AbortController();
    loginRequest.current = abort;
    const version = ++credentialVersion.current;
    const current = () => alive.current && roleRef.current === role && loginRequest.current === abort && credentialVersion.current === version;
    setState(previous => ({ ...previous, accessError: '', loggingIn: true }));
    const timeout = setTimeout(() => abort.abort(), accessTimeout);
    try {
      const response = await fetch(`${apiBase}/api/access?role=${role}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: abort.signal, cache: 'no-store' });
      const data: unknown = await response.json();
      if (!accessData(data)) throw new Error('Invalid login response. Please try again.');
      if (!response.ok) throw new Error(data.error || 'Login failed. Check your password or token.');
      if (!data.token?.trim()) throw new Error('Invalid login response. Please try again.');
      if (!current() || abort.signal.aborted) return;
      loginRequest.current = undefined;
      saveToken(data.token);
    } catch (error) {
      if (current()) {
        const message = abort.signal.aborted ? 'Login timed out. Please try again.' : error instanceof Error ? error.message : 'Login failed. Please try again.';
        setState(previous => ({ ...previous, accessError: message }));
      }
    } finally {
      clearTimeout(timeout);
      if (current()) { loginRequest.current = undefined; setState(previous => ({ ...previous, loggingIn: false })); }
    }
  }, [role, saveToken]);

  const visible = state.role === role ? state : emptyState(role);
  return { ...visible, saveToken, login };
}
