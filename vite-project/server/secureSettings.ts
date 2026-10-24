import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function protectSettings(value: string, decrypt = false): string {
  if (process.platform === 'win32') {
    const operation = decrypt ? 'Unprotect' : 'Protect';
    const script = `Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    const bytes = decrypt ? value : Buffer.from(value).toString('base64');
    const result = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        input: bytes,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    ).trim();
    return decrypt ? Buffer.from(result, 'base64').toString('utf8') : result;
  }
  const key = Buffer.from(process.env.HOK_CONFIG_KEY || '', 'base64');
  if (key.length !== 32)
    throw Error('Secure storage requires Windows DPAPI or HOK_CONFIG_KEY (32-byte base64)');
  if (decrypt) {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  }
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** One encrypted file, separate from match snapshots and recovery exports. */
export class SecureSettings {
  private data: Record<string, unknown> = {};
  readonly error?: string;
  constructor(
    private file: string,
    private crypt = protectSettings,
  ) {
    if (existsSync(file)) {
      try {
        const envelope = JSON.parse(readFileSync(file, 'utf8'));
        if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw Error();
        const data = JSON.parse(crypt(envelope.encrypted, true));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
        this.data = data;
      } catch {
        this.error = '安全配置无法解密；保留原文件，请使用原 Windows 用户登录或恢复原加密密钥。';
      }
    }
  }
  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }
  set(key: string, value: unknown) {
    if (this.error) throw Error(this.error);
    const next = { ...this.data, [key]: value };
    const encrypted = this.crypt(JSON.stringify(next));
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, encrypted }), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
    this.data = next;
  }
}
