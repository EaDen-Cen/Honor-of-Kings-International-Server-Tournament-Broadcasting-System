import { useState } from 'react';
import './teamLibraryTransfer.css';
import { apiURL } from '../shared/config';
import type { Language } from '../shared/types';

type Preview = {teams:number;images:number;newTeams:number;conflicts:number;externalAssets:string[]};
type ImportResult = {added:number;replaced:number;skipped:number;images:number;externalAssets:string[]};
type Conflict = 'skip' | 'replace';

export function TeamLibraryTransfer({
  token, lang, disabled, onImported, onBusy,
}: {token:string;lang:Language;disabled:boolean;onImported:()=>Promise<void>;onBusy:(value:boolean)=>void}) {
  const zh = lang === 'zh';
  const [busy,setBusy] = useState(false);
  const [bundle,setBundle] = useState<unknown>();
  const [filename,setFilename] = useState('');
  const [preview,setPreview] = useState<Preview>();
  const [conflict,setConflict] = useState<Conflict>('skip');
  const [error,setError] = useState('');
  const [result,setResult] = useState<ImportResult>();
  const label = (cn:string,en:string) => zh ? cn : en;

  const request = async (path:string, method='GET', body?:unknown) => {
    const response = await fetch(`${apiURL}/api/team-presets/transfer/${path}`,{
      method,headers:{Authorization:`Bearer ${token}`,...(body ? {'Content-Type':'application/json'}:{})},
      body:body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(String(data.error || response.status));
    return data;
  };
  const description = (key:string) => ({
    teamTransferMissingAsset:label('部分本地图片不存在，无法完整导出或导入。请检查图片后重试。','A referenced local image is missing. Check artwork before retrying.'),
    teamTransferTooLarge:label('资料包超过大小限制（最多 96 MB 图片数据）。','Library package exceeds the 96 MB artwork limit.'),
    teamTransferInvalid:label('资料包无效、格式不受支持或图片校验失败。','Invalid package, unsupported format or failed image integrity check.'),
    teamTransferFailed:label('数据迁移失败，原有资料没有被覆盖。','Transfer failed. Existing team records were preserved.'),
  }[key] || label('操作失败：','Operation failed: ')+key);
  const download = async () => {
    if (busy || disabled) return;
    setBusy(true);onBusy(true);setError('');setResult(undefined);
    try {
      const data = await request('export');
      const blob = new Blob([JSON.stringify(data)],{type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href=url;
      link.download=`hok-team-library-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch (e) {setError(description(e instanceof Error ? e.message : 'teamTransferFailed'));}
    finally {setBusy(false);onBusy(false);}
  };
  const choose = async (file?:File) => {
    setBundle(undefined);setPreview(undefined);setError('');setResult(undefined);
    setFilename(file?.name || '');
    if (!file) return;
    if (file.size > 135 * 1024 * 1024) {
      setError(description('teamTransferTooLarge'));return;
    }
    setBusy(true);onBusy(true);
    try {
      const parsed:unknown = JSON.parse(await file.text());
      const summary = await request('preview','POST',{bundle:parsed}) as Preview;
      setBundle(parsed);setPreview(summary);
    } catch(e) {setError(description(e instanceof Error ? e.message : 'teamTransferInvalid'));}
    finally {setBusy(false);onBusy(false);}
  };
  const apply = async () => {
    if (!preview || !bundle || busy || disabled) return;
    const text = conflict === 'replace'
      ? label(`导入 ${preview.teams} 支队伍，更新 ${preview.conflicts} 支同 ID 队伍？系统会先备份本机数据。`,
        `Import ${preview.teams} teams and replace ${preview.conflicts} matching IDs? A local backup will be created first.`)
      : label(`新增 ${preview.newTeams} 支队伍，跳过 ${preview.conflicts} 支重复队伍？`,
        `Add ${preview.newTeams} teams and skip ${preview.conflicts} matching IDs?`);
    if (!window.confirm(text)) return;
    setBusy(true);onBusy(true);setError('');setResult(undefined);
    try {
      const output = await request('import','POST',{bundle,conflict}) as ImportResult;
      await onImported();
      setResult(output);
      setBundle(undefined);setPreview(undefined);setFilename('');
    } catch (e) {setError(description(e instanceof Error ? e.message : 'teamTransferFailed'));}
    finally {setBusy(false);onBusy(false);}
  };
  return <section className="team-library-transfer">
    <h3>{label('跨电脑迁移队伍资料','Transfer team library between computers')}</h3>
    <p className="muted">{label(
      '导出包含队伍列表、首发与替补、分路、已上传的队徽和选手照片。不包含访问密钥、比赛记录或 AI API。',
      'Export includes teams, starters, substitutes, roles and locally uploaded images. Access tokens, matches and AI keys are excluded.',
    )}</p>
    <div className="toolbar">
      <button type="button" disabled={disabled||busy} onClick={()=>void download()}>
        {label('导出完整资料包','Export full library')}
      </button>
      <label className="upload-label">{label('选择导入文件','Choose import file')}
        <input type="file" accept=".json,application/json" disabled={disabled||busy}
          onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}} />
      </label>
    </div>
    {filename && <p className="muted">{filename}</p>}
    {preview && <div className="transfer-preview">
      <p>{label(
        `校验通过：${preview.teams} 支队伍、${preview.images} 张图片；新增 ${preview.newTeams} 支，已有 ${preview.conflicts} 支。`,
        `Validated: ${preview.teams} teams, ${preview.images} images; ${preview.newTeams} new and ${preview.conflicts} existing.`,
      )}</p>
      <label>{label('重复队伍的处理方式','When a team ID already exists')}
        <select value={conflict} disabled={disabled||busy} onChange={e=>setConflict(e.target.value as Conflict)}>
          <option value="skip">{label('保留本机队伍（跳过）','Keep local team (skip)')}</option>
          <option value="replace">{label('使用导入资料更新队伍','Replace matching team')}</option>
        </select>
      </label>
      <button type="button" className="primary" disabled={disabled||busy} onClick={()=>void apply()}>
        {label('确认导入','Confirm import')}
      </button>
    </div>}
    {!!preview?.externalAssets.length && <p className="muted" role="note">
      {label(`注意：${preview.externalAssets.length} 个外部或非托管图片地址未打包，导入后仍需原地址可访问。`,
        `Note: ${preview.externalAssets.length} external/unmanaged image URLs are not embedded and must remain accessible.`)}
    </p>}
    {error && <p role="alert" className="error">{error}</p>}
    {result && <p role="status" className="library-status">{label(
      `导入完成：新增 ${result.added}、更新 ${result.replaced}、跳过 ${result.skipped} 支队伍，保存 ${result.images} 张图片。`,
      `Import complete: ${result.added} added, ${result.replaced} updated, ${result.skipped} skipped; ${result.images} images saved.`,
    )}</p>}
  </section>;
}
