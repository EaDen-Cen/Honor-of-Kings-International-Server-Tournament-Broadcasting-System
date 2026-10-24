import { useEffect, useState } from 'react';
import { apiURL } from '../shared/config';
import { operatorPreferenceKey } from '../shared/operatorPreferences';
export function OperatorPreferences({ token }: { token: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let ready = false,
      busy = false,
      last = '';
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const read = () =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter(operatorPreferenceKey)
          .map((key) => [key, localStorage.getItem(key)]),
      );
    void fetch(`${apiURL}/api/v1/operator-preferences`, { headers, signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error('本地设置备份不可用');
        const saved = await r.json();
        let imported = false;
        for (const [key, value] of Object.entries(saved)) {
          if (
            operatorPreferenceKey(key) &&
            typeof value === 'string' &&
            localStorage.getItem(key) === null
          ) {
            localStorage.setItem(key, value);
            imported = true;
          }
        }
        if (imported) {
          location.reload();
          return;
        }
        last = JSON.stringify(saved);
        ready = true;
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    const timer = setInterval(() => {
      if (!ready || busy) return;
      let value: string;
      try {
        value = JSON.stringify(read());
      } catch {
        setError('浏览器存储不可用，设置无法备份');
        return;
      }
      if (value === last) return;
      busy = true;
      void fetch(`${apiURL}/api/v1/operator-preferences`, {
        method: 'PUT',
        headers,
        body: value,
        signal: abort.signal,
      })
        .then((r) => {
          if (!r.ok) throw Error('本地设置备份失败');
          last = value;
          setError('');
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(String(e));
        })
        .finally(() => {
          busy = false;
        });
    }, 5000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [token]);
  return error ? <p role="status">{error}</p> : null;
}
