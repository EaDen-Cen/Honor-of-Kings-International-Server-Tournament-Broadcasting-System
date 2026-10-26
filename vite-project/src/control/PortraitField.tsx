import { useEffect, useRef, useState } from 'react';
import { apiURL, portraitAssetURL } from '../shared/config';
import { translator, type MessageKey } from '../shared/i18n';
import type { Language } from '../shared/types';

export function PortraitField({ value, token, lang, disabled, onChange, onBusy, library = false, titleKey = 'portrait' }: {
  value: string; token: string; lang: Language; disabled: boolean; library?: boolean; titleKey?: MessageKey;
  onChange: (url: string) => void; onBusy: (busy: boolean) => void;
}) {
  const t = translator(lang);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<MessageKey>();
  const request = useRef<AbortController>();
  const mounted = useRef(true);
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (request.current) {
        request.current.abort();
        request.current = undefined;
        onBusyRef.current(false);
      }
    };
  }, []);
  useEffect(() => { setStatus('loading'); }, [value]);
  const src = portraitAssetURL(value);
  let requestedURL = src;
  try { requestedURL = new URL(src, location.href).href; } catch { /* Invalid text stays visible for correction. */ }
  async function upload(file?: File) {
    if (!file || disabled || request.current) return;
    setError(undefined);
    if (file.size > 5 * 1024 * 1024) { setError('uploadTooLarge'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('uploadFormat'); return; }
    const abort = new AbortController(); request.current = abort;
    setUploading(true); onBusy(true);
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(`${apiURL}/api/uploads/player-portrait`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal: abort.signal });
      if (!response.ok) throw new Error(response.status === 413 ? 'uploadTooLarge' : response.status === 415 ? 'uploadFormat' : [401, 403].includes(response.status) ? 'uploadUnauthorized' : 'uploadFailed');
      const data = await response.json();
      if (typeof data.url !== 'string' || !data.url) throw new Error('uploadFailed');
      if (mounted.current && request.current === abort && !abort.signal.aborted) onChange(data.url);
    } catch (cause) {
      if (mounted.current && request.current === abort) setError(cause instanceof Error && ['uploadTooLarge', 'uploadFormat', 'uploadUnauthorized'].includes(cause.message) ? cause.message as MessageKey : 'uploadFailed');
    } finally {
      clearTimeout(timeout);
      if (request.current === abort) {
        request.current = undefined;
        if (mounted.current) setUploading(false);
        onBusyRef.current(false);
      }
    }
  }
  return <div className="portrait-setting">
    <label>{t(titleKey)}<input aria-label={t(titleKey)} maxLength={1000} disabled={disabled || uploading} value={value} onChange={e => { setError(undefined); onChange(e.target.value); }} /></label>
    <div className="portrait-input">
      <div className={`portrait-preview portrait-${value ? status : 'empty'}`}>
        {value ? <img key={src} src={src} alt={t('portraitPreview')} onLoad={() => setStatus('loaded')} onError={() => setStatus('failed')} /> : <span>—</span>}
      </div>
      <div className="portrait-actions">
        <label className="upload-label">{t(uploading ? 'uploading' : 'choosePortrait')}<input aria-label={t('choosePortrait')} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <button type="button" disabled={disabled || uploading || !value} onClick={() => onChange('')}>{t('clearPortrait')}</button>
      </div>
    </div>
    <p className={`portrait-status ${status}`} role="status">{t(!value ? 'portraitEmpty' : status === 'loaded' ? 'portraitLoaded' : status === 'failed' ? 'portraitFailed' : 'portraitLoading')}</p>
    {value && <small className="portrait-url">{requestedURL}</small>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    <small>{titleKey === 'logoAddress' ? (lang === 'zh' ? '队伍 Logo 上传后会保存在本机，并包含在队伍资料导出包内。' : 'Uploaded team logos are stored locally and included in team library exports.') : t(library ? 'libraryPortraitUploadHint' : 'portraitUploadHint')}</small>
  </div>;
}
