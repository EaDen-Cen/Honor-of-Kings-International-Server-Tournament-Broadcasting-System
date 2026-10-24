import { useEffect, useState } from 'react';
type Vendor =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'doubao'
  | 'glm'
  | 'kimi'
  | 'baidu'
  | 'custom';
type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  vendor: Vendor;
  model: string;
  endpoint: string;
  configured: boolean;
};
type Config = {
  enabled: boolean;
  vendor: Vendor;
  model: string;
  endpoint: string;
  configured: boolean;
  activeId?: string;
  backupId?: string;
  profiles?: Profile[];
  storageError?: string;
};
const names: Record<Vendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  qwen: '阿里云 Qwen / 通义千问',
  doubao: '豆包 / 火山方舟',
  glm: '智谱 GLM',
  kimi: '月之暗面 Kimi',
  baidu: '百度千帆',
  custom: '自定义 OpenAI 兼容接口',
};
const empty: Config = {
  enabled: false,
  vendor: 'openai',
  model: '',
  endpoint: '',
  configured: false,
};
/**
 * Configuration is a local-only operator action, deliberately separate from match state.
 * Never persist API credentials in localStorage or the broadcast snapshot.
 */
export function AiRecognitionSettings({ token, zh }: { token: string; zh: boolean }) {
  const [config, setConfig] = useState<Config>(empty);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [profileId, setProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/ai-recognition/config', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error('Local Control required');
        return r.json() as Promise<Config>;
      })
      .then((value) => {
        setConfig(value);
        setProfileId(value.activeId || '');
        setProfileName(value.profiles?.find((p) => p.id === value.activeId)?.name || '');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(String(e));
      });
    return () => controller.abort();
  }, [token]);
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/ai-recognition/profiles', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          id: profileId,
          name: profileName || config.vendor,
          ...(apiKey ? { apiKey } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Save failed');
      setConfig(result as Config);
      setProfileId(result.activeId);
      setApiKey('');
      setMessage(zh ? 'AI 配置已加密保存，重启后自动加载。' : 'AI settings encrypted and saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="AI recognition settings">
      <h3>{zh ? 'AI 识别 · 多厂商 API' : 'AI Recognition · Multi-provider API'}</h3>
      <p className="muted">
        {zh
          ? 'AI 辅助英雄、选手、HUD 与赛后数字，仍经过原有校验。密钥在本机加密保存，重启自动加载；更换 Windows 用户后需重新配置。'
          : 'AI results pass existing validation. Credentials are encrypted for this OS user and survive restart.'}
      </p>
      {config.storageError && <p role="alert">{config.storageError}</p>}
      <label>
        {zh ? '已保存配置' : 'Saved profiles'}
        <select
          value={profileId}
          onChange={(e) => {
            const p = config.profiles?.find((p) => p.id === e.target.value);
            setProfileId(e.target.value);
            setProfileName(p?.name || '');
            setApiKey('');
            setConfig({ ...config, ...(p || empty) });
          }}
        >
          <option value="">新增配置</option>
          {config.profiles?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === config.activeId ? ' · 默认' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        配置名称
        <input
          value={profileName}
          maxLength={60}
          onChange={(e) => setProfileName(e.target.value)}
        />
      </label>
      <label className="settings-checkbox">
        <span>{zh ? '启用 AI 辅助识别' : 'Enable AI-assisted recognition'}</span>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
      </label>
      <label>
        {zh ? 'API 服务商' : 'API provider'}
        <select
          value={config.vendor}
          onChange={(e) => setConfig({ ...config, vendor: e.target.value as Vendor, endpoint: '' })}
        >
          {(Object.keys(names) as Vendor[]).map((v) => (
            <option key={v} value={v}>
              {names[v]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {zh ? '视觉模型 ID' : 'Vision model ID'}
        <input
          value={config.model}
          maxLength={100}
          placeholder="e.g. gpt-4o"
          onChange={(e) => setConfig({ ...config, model: e.target.value })}
        />
      </label>
      <label>
        {zh
          ? 'API Key（同一接口留空可沿用；切换服务商需重新输入）'
          : 'API key (blank keeps key only for the same endpoint)'}
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config.configured ? '••••••••' : 'API key'}
        />
      </label>
      <label>
        {zh ? '接口 URL（留空使用厂商默认地址）' : 'Endpoint URL (blank uses provider default)'}
        <input
          value={config.endpoint}
          placeholder={
            config.vendor === 'custom'
              ? 'https://provider.example/v1/chat/completions'
              : 'Default provider endpoint'
          }
          onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
        />
      </label>
      <p className="muted">
        {zh
          ? '必须选择支持图片输入的模型；仅本机 Control 可修改。国内平台部分模型、地区或账户可能不支持视觉输入。'
          : 'Choose a vision-capable model. Local Control only. Some models, regions, or accounts do not support image inputs.'}
      </p>
      <button type="button" disabled={busy} onClick={save}>
        {busy ? (zh ? '保存中…' : 'Saving…') : zh ? '应用 AI 配置' : 'Apply AI settings'}
      </button>
      <button
        type="button"
        disabled={busy || !config.configured}
        onClick={() => {
          setBusy(true);
          fetch('/api/v1/ai-recognition/test', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            signal: AbortSignal.timeout(10000),
          })
            .then(async (r) => {
              const data = await r.json();
              if (!r.ok) throw Error(data.error);
              setMessage('当前默认视觉模型连接成功');
            })
            .catch((e) => setMessage(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        测试默认连接
      </button>
      <label>
        备用配置（失败时共用原有总超时）
        <select
          value={config.backupId || ''}
          disabled={busy || !config.activeId}
          onChange={(e) => {
            setBusy(true);
            void fetch('/api/v1/ai-recognition/profiles', {
              method: 'PUT',
              signal: AbortSignal.timeout(10000),
              headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ activeId: config.activeId, backupId: e.target.value }),
            })
              .then(async (r) => {
                const data = await r.json();
                if (!r.ok) throw Error(data.error);
                setConfig((current) => ({
                  ...current,
                  profiles: data.profiles,
                  activeId: data.activeId,
                  backupId: data.backupId,
                }));
              })
              .catch((e) => setMessage(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <option value="">无备用</option>
          {config.profiles
            ?.filter((p) => p.id !== config.activeId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !profileId}
        onClick={() => {
          setBusy(true);
          void fetch('/api/v1/ai-recognition/profiles', {
            method: 'DELETE',
            signal: AbortSignal.timeout(10000),
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: profileId }),
          })
            .then(async (r) => {
              const data = await r.json();
              if (!r.ok) throw Error(data.error);
              setConfig(data);
              setProfileId(data.activeId || '');
              setProfileName(
                data.profiles?.find((p: Profile) => p.id === data.activeId)?.name || '',
              );
              setApiKey('');
              setMessage('已删除配置及密钥');
            })
            .catch((e) => setMessage(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        删除所选配置及密钥
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
