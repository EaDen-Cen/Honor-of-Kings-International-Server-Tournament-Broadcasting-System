import { randomUUID } from 'node:crypto';
import { AiRecognitionService, aiRecognition } from './aiRecognition.js';
import type { SecureSettings } from './secureSettings.js';
type Profile = {
  id: string;
  name: string;
  config: ReturnType<AiRecognitionService['savedConfig']>;
};
type Profiles = { profiles: Profile[]; activeId: string; backupId: string };
export class AiProfiles {
  private data: Profiles;
  error = '';
  constructor(
    private storage: SecureSettings,
    private service = aiRecognition,
  ) {
    this.data = { profiles: [], activeId: '', backupId: '' };
    try {
      const saved = storage.get<Profiles>('ai');
      if (saved) {
        if (
          !Array.isArray(saved.profiles) ||
          typeof saved.activeId !== 'string' ||
          typeof saved.backupId !== 'string' ||
          saved.profiles.length > 10 ||
          saved.profiles.some(
            (p) => !p || typeof p.id !== 'string' || typeof p.name !== 'string',
          ) ||
          new Set(saved.profiles.map((p) => p.id)).size !== saved.profiles.length
        )
          throw Error('Invalid saved profiles');
        for (const profile of saved.profiles) new AiRecognitionService().configure(profile.config);
        if (
          (saved.activeId && !saved.profiles.some((p) => p.id === saved.activeId)) ||
          (saved.backupId && !saved.profiles.some((p) => p.id === saved.backupId))
        )
          throw Error('Missing selected profile');
        this.data = saved;
      }
      this.apply();
    } catch {
      this.data = { profiles: [], activeId: '', backupId: '' };
      this.error = 'AI 配置加载失败，已保留原配置；请检查配置文件版本。';
    }
  }
  private apply() {
    const active = this.data.profiles.find((p) => p.id === this.data.activeId);
    if (active) this.service.configure(active.config);
    this.service.configureBackup(
      this.data.profiles.find((p) => p.id === this.data.backupId)?.config,
    );
  }
  publicConfig() {
    return {
      ...this.service.publicConfig(),
      activeId: this.data.activeId,
      backupId: this.data.backupId,
      profiles: this.data.profiles.map((p) => {
        const { apiKey, ...config } = p.config;
        return { id: p.id, name: p.name, ...config, configured: !!apiKey };
      }),
      storageError: this.storage.error || this.error,
    };
  }
  save(input: Record<string, unknown>) {
    if (this.error) throw Error(this.error);
    const id = typeof input.id === 'string' && input.id ? input.id : randomUUID();
    const previous = this.data.profiles.find((p) => p.id === id);
    if (!previous && this.data.profiles.length >= 10) throw Error('最多保存 10 个 AI 配置');
    const validator = new AiRecognitionService();
    if (previous) validator.configure(previous.config);
    validator.configure(input);
    const profile = {
      id,
      name:
        typeof input.name === 'string'
          ? input.name.trim().slice(0, 60) || 'AI'
          : previous?.name || String(input.vendor),
      config: validator.savedConfig(),
    };
    const next = {
      ...this.data,
      profiles: [...this.data.profiles.filter((p) => p.id !== id), profile],
      activeId: input.makeDefault === false ? this.data.activeId : id,
    };
    if (next.activeId === next.backupId) next.backupId = '';
    this.storage.set('ai', next);
    this.data = next;
    this.apply();
    return this.publicConfig();
  }
  select(activeId: string, backupId: string) {
    if (this.error) throw Error(this.error);
    if (
      !this.data.profiles.some((p) => p.id === activeId) ||
      (backupId && (!this.data.profiles.some((p) => p.id === backupId) || activeId === backupId))
    )
      throw Error('Invalid AI profile selection');
    const next = { ...this.data, activeId, backupId };
    this.storage.set('ai', next);
    this.data = next;
    this.apply();
    return this.publicConfig();
  }
  remove(id: string) {
    if (this.error) throw Error(this.error);
    const profiles = this.data.profiles.filter((p) => p.id !== id);
    const next = {
      profiles,
      activeId: this.data.activeId === id ? profiles[0]?.id || '' : this.data.activeId,
      backupId: this.data.backupId === id ? '' : this.data.backupId,
    };
    if (next.activeId === next.backupId) next.backupId = '';
    this.storage.set('ai', next);
    this.data = next;
    if (!next.activeId)
      this.service.configure({ ...this.service.publicConfig(), enabled: false, apiKey: '' });
    this.apply();
    return this.publicConfig();
  }
}
