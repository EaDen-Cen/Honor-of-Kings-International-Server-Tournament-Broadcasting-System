import { useEffect, useRef, useState } from 'react';
import { apiBase } from '../shared/access';
import { AccessSettingsFailure, fetchAccessSettings, publicWebsiteBase, sharingLinks, type SharingTokens } from './accessSettingsRequest';

function savedWebsite() {
  try { return localStorage.getItem('hok-public-url') || ''; } catch { return ''; }
}

export function AccessSettings({ token, onToken, zh }: { token: string; onToken: (token: string) => void; zh: boolean }) {
  const [tokens, setTokens] = useState<SharingTokens>();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<'password' | 'links' | 'copy'>();
  const [publicURL, setPublicURL] = useState(savedWebsite);
  const [storageWarning, setStorageWarning] = useState(false);
  const mounted = useRef(true);
  const request = useRef<AbortController>();
  const active = useRef<typeof busy>();
  const currentToken = useRef(token);
  currentToken.current = token;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    setTokens(undefined);
    // A password rotation invalidates any in-flight read of the old role tokens.
    if (active.current === 'links') request.current?.abort();
  }, [token]);

  let website = '';
  let invalidWebsite = false;
  try { website = publicWebsiteBase(publicURL, location.origin); } catch { invalidWebsite = true; }
  const links: Record<string, string> = tokens && !invalidWebsite ? sharingLinks(website, tokens) : {};

  function failureMessage(cause: unknown, saving: boolean) {
    if (cause instanceof AccessSettingsFailure) {
      if (cause.code === 'unauthorized') return zh ? '访问口令已失效。请重新登录后再试。' : 'Your access token has expired. Sign in again and retry.';
      if (cause.code === 'timeout' && saving) return zh ? '保存结果未确认，密码可能已经生效。请用新密码确认登录后再试，系统不会自动重复保存。' : 'The save result could not be confirmed; the password may already be active. Check access with the new password before retrying. The save will not be repeated automatically.';
      if (cause.code === 'timeout') return zh ? '连接超时，请检查服务器连接后重试。' : 'The connection timed out. Check the server connection and retry.';
      if (cause.code === 'invalidResponse') return zh ? '服务器返回内容不完整，请检查服务状态后重试。' : 'The server returned incomplete data. Check the service and retry.';
      if (cause.code === 'rejected') return `${zh ? '服务器未接受设置' : 'The server rejected the settings'}${cause.detail ? `: ${cause.detail}` : ''}`;
    }
    return saving
      ? (zh ? '保存结果未确认，请检查连接并用新密码确认登录。输入内容已保留。' : 'The save result could not be confirmed. Check the connection and access with the new password. Your input was kept.')
      : (zh ? '无法读取分享链接，请检查服务器连接后重试。' : 'Could not load sharing links. Check the server connection and retry.');
  }

  async function run(kind: 'password' | 'links') {
    if (active.current || (kind === 'links' && invalidWebsite)) return;
    active.current = kind;
    setBusy(kind); setMessage(''); setError(false);
    if (kind === 'password') setTokens(undefined);
    const abort = new AbortController(); request.current = abort;
    const sentToken = currentToken.current;
    try {
      const data = await fetchAccessSettings(`${apiBase}/api/access`, sentToken, { password: kind === 'password' ? password : undefined, signal: abort.signal });
      if (!mounted.current || abort.signal.aborted) return;
      if (kind === 'password') {
        onToken(data.token!);
        setPassword(''); setTokens(undefined);
        setMessage(zh ? '密码已保存。旧分享链接已失效，请重新生成并发送新链接。' : 'Password saved. Previous sharing links are now invalid; generate and share new links.');
      } else if (sentToken === currentToken.current) {
        setTokens(data.tokens);
        setMessage(zh ? '链接已生成。持有链接的人可以打开对应的只读页面，请谨慎分享。' : 'Links generated. Anyone with a link can open its read-only page; share them carefully.');
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) { setMessage(failureMessage(cause, kind === 'password')); setError(true); }
    } finally {
      if (request.current === abort) { request.current = undefined; active.current = undefined; if (mounted.current) setBusy(undefined); }
    }
  }

  async function copyLink(url: string) {
    if (active.current) return;
    active.current = 'copy'; setBusy('copy'); setError(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await Promise.race([navigator.clipboard.writeText(url), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Clipboard timed out')), 5000); })]);
      if (mounted.current) setMessage(zh ? '链接已复制。' : 'Link copied.');
    } catch {
      if (mounted.current) { setMessage(zh ? '无法自动复制，请点击链接文本全选后手动复制。' : 'Could not copy automatically. Select the link text and copy it manually.'); setError(true); }
    } finally {
      clearTimeout(timeout); active.current = undefined;
      if (mounted.current) setBusy(undefined);
    }
  }

  return <section className="panel" aria-busy={!!busy}>
    <h2>{zh ? '访问与网站设置' : 'Access and website settings'}</h2>
    <form onSubmit={event => { event.preventDefault(); void run('password'); }}>
      <label>{zh ? '远程访问密码（8–256 个字符）' : 'Remote password (8–256 characters)'}<input type="password" minLength={8} maxLength={256} required autoComplete="new-password" disabled={!!busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <p className="muted">{zh ? '保存后会更新各端访问口令，旧分享链接将失效；已连接页面会自动更新。' : 'Saving rotates all role tokens and invalidates previous sharing links. Connected pages update automatically.'}</p>
      <button disabled={!!busy}>{busy === 'password' ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存密码' : 'Save password')}</button>
    </form>
    <label>{zh ? '公网网址（留空使用当前网址）' : 'Public website URL (leave blank to use this website)'}<input type="url" aria-invalid={invalidWebsite} aria-describedby={invalidWebsite ? 'public-website-error' : undefined} placeholder="https://broadcast.example.com" disabled={!!busy} value={publicURL} onChange={event => {
      const value = event.target.value; setPublicURL(value);
      try { localStorage.setItem('hok-public-url', value); setStorageWarning(false); } catch { setStorageWarning(true); }
    }} /></label>
    {invalidWebsite && <p className="error" id="public-website-error" role="alert">{zh ? '请输入完整的 http:// 或 https:// 域名，不要包含页面路径、参数或访问口令。' : 'Enter a complete http:// or https:// website address without page paths, query parameters or access tokens.'}</p>}
    {storageWarning && <p className="muted">{zh ? '浏览器未允许保存网址；当前设置仍可使用，关闭页面后需重新填写。' : 'Your browser could not save this address. It works for this session; enter it again after closing the page.'}</p>}
    <button type="button" disabled={!!busy || invalidWebsite} onClick={() => void run('links')}>{busy === 'links' ? (zh ? '正在生成…' : 'Generating…') : (zh ? '生成只读分享链接' : 'Generate read-only sharing links')}</button>
    {Object.entries(links).map(([role, url]) => <div key={role}>
      <label>{role === 'caster' ? (zh ? '解说端' : 'Caster') : (zh ? '直播画面' : 'Overlay')}<input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" disabled={!!busy} onClick={() => void copyLink(url)}>{zh ? '复制链接' : 'Copy link'}</button>
    </div>)}
    <p className="muted">{zh ? '本机 localhost / 127.0.0.1 由服务器验证后免登录；公网网址仅用于打开页面，部署仍需域名与服务器配置。' : 'Server-verified loopback access skips login. Public URL opens pages; hosting still requires domain and server configuration.'}</p>
    {publicURL.trim() && !invalidWebsite && <div className="toolbar">{['control', 'caster', 'overlay/draft'].map(path => <a key={path} href={`${website}/${path}`} target="_blank" rel="noreferrer">{path}</a>)}</div>}
    <p role={error ? 'alert' : 'status'} className={error ? 'error' : undefined}>{message}</p>
  </section>;
}
