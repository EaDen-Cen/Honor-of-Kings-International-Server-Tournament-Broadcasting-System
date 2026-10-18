import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { allPoolHeroes } from '../shared/heroPool';
import { heroesForState } from '../shared/heroData';
import { defaultHeroArtCrop, heroArtCrop } from '../data/heroArtFocus';
import { translator } from '../shared/i18n';
import { heroMatchesSearch } from './heroSearch';
import { heroDataChanges, heroDataDraft, heroDataIssue, parseHeroAliases } from './heroEditorDraft';
import type { Action, HeroArtCrop, HeroArtLayout, HeroArtOverride, HeroDataOverride, MatchState } from '../shared/types';

const targetAspect: Record<HeroArtLayout, number> = {
  // Matches the actual 1920x1080 broadcast card viewports.
  panel: 0.65,
  side: 1.90,
};

interface SourceSize { width: number; height: number }

function AliasInput({ value, label, hint, onChange }: { value: string[]; label: string; hint: string; onChange: (aliases: string[]) => void }) {
  const [text, setText] = useState(() => value.join(', '));
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(parseHeroAliases(text))) setText(value.join(', '));
  }, [value, text]);
  return <label>{label}<input maxLength={500} value={text} onChange={event => { setText(event.target.value); onChange(parseHeroAliases(event.target.value)); }} /><small>{hint}</small></label>;
}

function sourceFrame(crop: HeroArtCrop, layout: HeroArtLayout, source: SourceSize) {
  const { width, height } = source;
  const viewportAspect = targetAspect[layout];
  const sourceAspect = width / height;
  const px = crop.x / 100;
  const py = crop.y / 100;

  let visibleWidth = width;
  let visibleHeight = height;
  let baseLeft = 0;
  let baseTop = 0;

  // This is the exact source rectangle produced by object-fit: cover before
  // the additional director zoom is applied.
  if (sourceAspect > viewportAspect) {
    visibleWidth = height * viewportAspect;
    baseLeft = (width - visibleWidth) * px;
  } else {
    visibleHeight = width / viewportAspect;
    baseTop = (height - visibleHeight) * py;
  }

  const focalX = width * px;
  const focalY = height * py;
  const scale = Math.max(1, crop.scale);
  const left = focalX + (baseLeft - focalX) / scale;
  const top = focalY + (baseTop - focalY) / scale;

  return {
    left,
    top,
    width: visibleWidth / scale,
    height: visibleHeight / scale,
  };
}

function frameStyle(crop: HeroArtCrop, layout: HeroArtLayout, source: SourceSize): CSSProperties {
  const frame = sourceFrame(crop, layout, source);
  return {
    left: `${frame.left / source.width * 100}%`,
    top: `${frame.top / source.height * 100}%`,
    width: `${frame.width / source.width * 100}%`,
    height: `${frame.height / source.height * 100}%`,
  };
}

function CropPreview({
  src,
  crop,
  layout,
  legacy,
  alt,
}: {
  src: string;
  crop: HeroArtCrop;
  layout: HeroArtLayout;
  legacy: boolean;
  alt: string;
}) {
  const [size, setSize] = useState<SourceSize>({ width: 16, height: 9 });
  const [failedSource, setFailedSource] = useState('');
  const frame = sourceFrame(crop, layout, size);

  // Important: preview the source rectangle directly from the ORIGINAL image.
  // Do not object-fit:cover first and then transform that already-cropped result.
  const originalCropStyle: CSSProperties = legacy ? {} : {
    position: 'absolute',
    left: `${-frame.left / frame.width * 100}%`,
    top: `${-frame.top / frame.height * 100}%`,
    width: `${size.width / frame.width * 100}%`,
    height: `${size.height / frame.height * 100}%`,
    maxWidth: 'none',
  };

  return <div className={`art-editor-preview art-editor-preview-${layout}`}>
    <img
      src={src}
      alt={alt}
      className={legacy ? 'legacy-preview-image' : 'source-crop-preview-image'}
      style={originalCropStyle}
      onLoad={event => setSize({
        width: event.currentTarget.naturalWidth || 16,
        height: event.currentTarget.naturalHeight || 9,
      })}
      onError={() => setFailedSource(src)}
    />
    {failedSource === src && <p role="status">{alt} · ⚠</p>}
  </div>;
}

function CropControls({
  label,
  crop,
  onChange,
}: {
  label: string;
  crop: HeroArtCrop;
  onChange: (crop: HeroArtCrop) => void;
}) {
  const set = (field: keyof HeroArtCrop, value: number) => onChange({ ...crop, [field]: value });
  return <fieldset className="art-editor-crop-controls">
    <legend>{label}</legend>
    <label>X · {Math.round(crop.x)}%
      <input type="range" min={0} max={100} step={1} value={crop.x} onChange={e => set('x', Number(e.target.value))} />
    </label>
    <label>Y · {Math.round(crop.y)}%
      <input type="range" min={0} max={100} step={1} value={crop.y} onChange={e => set('y', Number(e.target.value))} />
    </label>
    <label>Scale · {crop.scale.toFixed(2)}×
      <input type="range" min={1} max={3} step={0.01} value={crop.scale} onChange={e => set('scale', Number(e.target.value))} />
    </label>
  </fieldset>;
}

export function HeroArtEditorDialog({
  state,
  disabled,
  send,
  onClose,
}: {
  state: MatchState;
  disabled: boolean;
  send: (action: Action) => void;
  onClose: () => void;
}) {
  const t = translator(state.language);
  const dialog = useRef<HTMLDialogElement>(null);
  const currentPicks = [...state.bluePicks, ...state.redPicks];
  const effectiveHeroes = useMemo(() => heroesForState({heroDataOverrides:state.heroDataOverrides,heroPool:state.heroPool}), [state.heroDataOverrides,state.heroPool]);
  const initialId = currentPicks.find(id => effectiveHeroes.some(hero => hero.id === id)) ?? effectiveHeroes[0]?.id ?? 1;
  const [heroId, setHeroId] = useState(initialId);
  const [heroQuery, setHeroQuery] = useState('');
  const [visibleHeroCount, setVisibleHeroCount] = useState(48);
  const drafts = useRef(new Map<number, { art: HeroArtOverride; data: HeroDataOverride }>());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef<{ heroId: number; kind: 'art' | 'data'; expected: string }>();
  const [failedSource, setFailedSource] = useState('');

  const makeDraft = (id: number): HeroArtOverride => {
    const runtime = state.heroArtOverrides?.[String(id)];
    return {
      useLegacyImage: runtime?.useLegacyImage ?? false,
      panel: { ...heroArtCrop(id, 'panel', runtime) },
      side: { ...heroArtCrop(id, 'side', runtime) },
    };
  };

  const [draft, setDraft] = useState<HeroArtOverride>(() => makeDraft(initialId));
  const makeDataDraft = (id: number): HeroDataOverride => {
    const base = allPoolHeroes.find(item => item.id === id);
    return base ? heroDataDraft(base, state.heroDataOverrides?.[String(id)]) : {};
  };
  const [dataDraft, setDataDraft] = useState<HeroDataOverride>(() => makeDataDraft(initialId));
  const selectHero = (nextId: number) => {
    if (nextId === heroId) return;
    drafts.current.set(heroId, { art: draft, data: dataDraft });
    const saved = drafts.current.get(nextId);
    setHeroId(nextId);
    setDraft(saved?.art ?? makeDraft(nextId));
    setDataDraft(saved?.data ?? makeDataDraft(nextId));
  };
  useEffect(() => {
    if (effectiveHeroes.some(item => item.id === heroId)) return;
    const nextHero = effectiveHeroes[0];
    if (!nextHero) return;
    const runtime = state.heroArtOverrides?.[String(nextHero.id)];
    setHeroId(nextHero.id);
    setDraft({ useLegacyImage: runtime?.useLegacyImage ?? false, panel: { ...heroArtCrop(nextHero.id, 'panel', runtime) }, side: { ...heroArtCrop(nextHero.id, 'side', runtime) } });
    setDataDraft(heroDataDraft(allPoolHeroes.find(item => item.id === nextHero.id)!, state.heroDataOverrides?.[String(nextHero.id)]));
  }, [effectiveHeroes, heroId, state.heroArtOverrides, state.heroDataOverrides]);
  const [sourceSize, setSourceSize] = useState<SourceSize>({ width: 16, height: 9 });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    const actual = request.kind === 'art' ? state.heroArtOverrides?.[String(request.heroId)] : state.heroDataOverrides?.[String(request.heroId)];
    if (JSON.stringify(actual ?? {}) === request.expected) {
      pending.current = undefined; setSaving(false); setError(false);
      setNotice(state.language === 'zh' ? '更改已同步至服务器。' : 'Changes synced to the server.');
    }
  }, [state.heroArtOverrides, state.heroDataOverrides, state.language, saving]);
  useEffect(() => {
    if (!saving) return;
    const timeout = setTimeout(() => {
      pending.current = undefined; setSaving(false); setError(true);
      setNotice(state.language === 'zh' ? '尚未确认保存。请检查连接后重试，草稿已保留。' : 'The save has not been confirmed. Check the connection and retry; your draft was kept.');
    }, 10000);
    return () => clearTimeout(timeout);
  }, [saving, state.language]);

  const hero = useMemo(() => effectiveHeroes.find(item => item.id === heroId) ?? effectiveHeroes[0], [effectiveHeroes, heroId]);
  const filteredHeroes = useMemo(
    () => effectiveHeroes.filter(item => heroMatchesSearch(item, heroQuery, state.language)),
    [effectiveHeroes, heroQuery, state.language],
  );
  const visibleHeroes = filteredHeroes.slice(0, visibleHeroCount);
  const hasMoreHeroes = visibleHeroCount < filteredHeroes.length;
  if (!hero) return null;

  const panel = draft.panel ?? defaultHeroArtCrop('panel');
  const side = draft.side ?? defaultHeroArtCrop('side');
  const draftPortrait = dataDraft.imageLink?.trim() || hero.imageLink;
  const draftArt = dataDraft.artLink?.trim() || hero.artLink;
  const forcedLegacy = state.artSourceMode === 'legacy' || draft.useLegacyImage === true || !draftArt;
  const source = forcedLegacy ? draftPortrait : draftArt!;
  const fullSource = draftArt || draftPortrait;
  const heroName = state.language === 'zh' ? hero.chineseName : hero.englishName;
  const zh = state.language === 'zh';
  const baseHero = allPoolHeroes.find(item => item.id === hero.id)!;
  const dataChanges = heroDataChanges(baseHero, dataDraft);
  const issue = heroDataIssue(dataChanges);
  const unsaved = JSON.stringify(dataChanges) !== JSON.stringify(state.heroDataOverrides?.[String(hero.id)] ?? {}) || JSON.stringify(draft) !== JSON.stringify(makeDraft(hero.id));

  function save(action: Action, kind: 'art' | 'data', expected: HeroArtOverride | HeroDataOverride) {
    if (disabled || pending.current) return;
    const expectedJSON = JSON.stringify(expected);
    const actual = kind === 'art' ? state.heroArtOverrides?.[String(hero!.id)] : state.heroDataOverrides?.[String(hero!.id)];
    if (JSON.stringify(actual ?? {}) === expectedJSON) {
      setError(false); setNotice(zh ? '设置已是当前值。' : 'These settings are already current.'); return;
    }
    pending.current = { heroId: hero!.id, kind, expected: expectedJSON };
    setSaving(true); setError(false); setNotice(zh ? '正在保存…' : 'Saving…');
    try { send(action); } catch {
      pending.current = undefined; setSaving(false); setError(true);
      setNotice(zh ? '无法发送，请检查连接后重试，草稿已保留。' : 'Could not send. Check the connection and retry; your draft was kept.');
    }
  }

  const resetLayout = (layout: HeroArtLayout) => {
    setDraft(previous => ({ ...previous, [layout]: { ...heroArtCrop(hero.id, layout) } }));
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="hero-art-editor-dialog"
      aria-label={t('heroImageSettings')}
      onCancel={event => { event.preventDefault(); onClose(); }}
    >
      <header className="hero-art-editor-header">
        <div><strong>{t('heroImageSettings')}</strong><small>{heroName}{unsaved ? (zh ? ' · 有未保存的更改' : ' · Unsaved changes') : ''}</small></div>
        <button type="button" onClick={onClose}>{t('closeHeroImageSettings')}</button>
      </header>

      <div className="hero-art-editor-body">
        <aside className="hero-art-editor-controls">
          {notice && <p className={error ? 'error' : 'notice'} role={error ? 'alert' : 'status'}>{notice}</p>}
          <p className="muted">{zh ? '切换英雄会保留本次打开时的草稿。请保存修改后再关闭窗口。' : 'Switching heroes keeps drafts while this window is open. Save your changes before closing.'}</p>
          <section className="hero-studio-selector">
            <label className="hero-studio-search">{t('heroStudioSearch')}
              <input
                value={heroQuery}
                placeholder={t('heroStudioSearchHintGrid')}
                onChange={event => {
                  setHeroQuery(event.target.value);
                  setVisibleHeroCount(48);
                }}
              />
            </label>
            <div className="hero-studio-grid" role="list" aria-label={t('heroStudioSearchResults')}>
              {visibleHeroes.map(item => {
                const selectedHero=item.id===hero.id;
                const displayName=state.language==='zh'?item.chineseName:item.englishName;
                return <button
                  type="button"
                  role="listitem"
                  key={item.id}
                  className={selectedHero?'selected':''}
                  aria-current={selectedHero ? 'true' : undefined}
                  onClick={()=>selectHero(item.id)}
                  title={item.englishName}
                >
                  <img src={item.imageLink} alt="" />
                  <span>{displayName}</span>
                  <small>{item.occupation}</small>
                </button>;
              })}
              {!filteredHeroes.length && <p role="status">{zh ? '未找到英雄，请尝试其他名称或拼音声母。' : 'No heroes found. Try another name or initials.'}</p>}
            </div>
            <div className="hero-studio-list-footer">
              <small>{t('heroStudioResultCount',{shown:visibleHeroes.length,total:filteredHeroes.length})}</small>
              {hasMoreHeroes&&<div className="hero-studio-list-actions">
                <button type="button" onClick={()=>setVisibleHeroCount(count=>Math.min(count+48,filteredHeroes.length))}>{t('heroStudioLoadMore')}</button>
                <button type="button" onClick={()=>setVisibleHeroCount(filteredHeroes.length)}>{t('heroStudioShowAll')}</button>
              </div>}
            </div>
          </section>

          <details className="advanced-options"><summary>{state.language === 'zh' ? '英雄数据 · 高级选项' : 'Hero data · advanced'}</summary>
            <fieldset className="hero-data-editor">
              <legend>{t('heroDataSettings')}</legend>
              <label>{t('heroChineseName')}<input maxLength={60} value={dataDraft.chineseName ?? ''} onChange={event => setDataDraft(previous => ({ ...previous, chineseName: event.target.value }))} /></label>
              <label>{t('heroEnglishName')}<input maxLength={60} value={dataDraft.englishName ?? ''} onChange={event => setDataDraft(previous => ({ ...previous, englishName: event.target.value }))} /></label>
              <label>{t('heroPrimaryLane')}<select value={dataDraft.occupation ?? ''} onChange={event => setDataDraft(previous => ({ ...previous, occupation: event.target.value }))}>{['Clash Lane','Jungling','Mid Lane','Farm Lane','Roaming'].map(lane => <option key={lane} value={lane}>{lane}</option>)}</select></label>
              <label>{t('heroSecondaryLane')}<select value={dataDraft.altOccupation ?? ''} onChange={event => setDataDraft(previous => ({ ...previous, altOccupation: event.target.value }))}><option value="">{t('noSecondaryLane')}</option>{['Clash Lane','Jungling','Mid Lane','Farm Lane','Roaming'].map(lane => <option key={lane} value={lane}>{lane}</option>)}</select></label>
              <AliasInput key={hero.id} label={t('heroAliases')} hint={t('heroAliasesHint')} value={dataDraft.aliases ?? []} onChange={aliases => setDataDraft(previous => ({ ...previous, aliases }))} />
              <label>{t('heroPortraitOverride')}<input maxLength={1000} value={dataDraft.imageLink ?? ''} onChange={event => setDataDraft(previous => ({ ...previous, imageLink: event.target.value }))} /><small>{t('heroSourceOverrideHint')}</small></label>
              <label>{t('heroFullArtOverride')}<input maxLength={1000} value={dataDraft.artLink ?? ''} onChange={event => setDataDraft(previous => ({ ...previous, artLink: event.target.value }))} /><small>{t('heroSourceOverrideHint')}</small></label>
              <div className="art-editor-actions">
                <button type="button" className="primary" disabled={disabled || saving || !!issue} onClick={() => save({ type: 'hero_data_override', heroId: hero.id, override: dataChanges }, 'data', dataChanges)}>{t('saveHeroData')}</button>
                <button type="button" disabled={disabled || saving} onClick={() => { save({ type: 'reset_hero_data_override', heroId: hero.id }, 'data', {}); setDataDraft(heroDataDraft(baseHero)); }}>{t('resetHeroData')}</button>
              </div>
              {issue && <p className="error" role="alert">{issue === 'name' ? (zh ? '中英文名称不能为空。' : 'Chinese and English names cannot be empty.') : issue === 'aliases' ? (zh ? '别名最多 20 个，每个最多 60 个字符。' : 'Use up to 20 aliases, with at most 60 characters each.') : (zh ? '图片地址必须是本站 / 开头的路径或 HTTPS 链接，不能包含空格。留空可恢复默认图片。' : 'Image sources must be local / paths or HTTPS URLs without spaces. Leave blank to use the default image.')}</p>}
            </fieldset>
          </details>

          <label className="art-editor-checkbox">
            <input
              type="checkbox"
              checked={draft.useLegacyImage === true}
              disabled={!draftArt}
              onChange={event => setDraft(previous => ({ ...previous, useLegacyImage: event.target.checked }))}
            />
            {t('useLegacyForHero')}
          </label>
          {!draftArt && <p className="notice">{t('fullArtUnavailable')}</p>}

          <CropControls label={t('cropPanel')} crop={panel} onChange={crop => setDraft(previous => ({ ...previous, panel: crop }))} />
          <button type="button" onClick={() => resetLayout('panel')}>{t('resetCrop')} · {t('panelLayout')}</button>

          <CropControls label={t('cropSide')} crop={side} onChange={crop => setDraft(previous => ({ ...previous, side: crop }))} />
          <button type="button" onClick={() => resetLayout('side')}>{t('resetCrop')} · {t('sideLayout')}</button>

          <div className="art-editor-actions">
            <button
              type="button"
              className="primary"
              disabled={disabled || saving}
              onClick={() => save({ type: 'hero_art_override', heroId: hero.id, override: draft }, 'art', draft)}
            >{t('saveHeroArt')}</button>
            <button
              type="button"
              className="danger"
              disabled={disabled || saving}
              onClick={() => {
                save({ type: 'reset_hero_art_override', heroId: hero.id }, 'art', {});
                setDraft({
                  useLegacyImage: false,
                  panel: { ...heroArtCrop(hero.id, 'panel') },
                  side: { ...heroArtCrop(hero.id, 'side') },
                });
              }}
            >{t('resetHeroArt')}</button>
          </div>
        </aside>

        <section className="hero-art-editor-stage">
          <div>
            <h3>{t('artReference')}</h3>
            <p className="muted">{t('artReferenceHint')}</p>
          </div>
          <div
            className="art-editor-reference"
            style={{ aspectRatio: `${sourceSize.width} / ${sourceSize.height}` }}
          >
            <img
              key={fullSource}
              src={fullSource}
              alt={heroName}
              onLoad={event => setSourceSize({
                width: event.currentTarget.naturalWidth || 16,
                height: event.currentTarget.naturalHeight || 9,
              })}
              onError={() => setFailedSource(fullSource)}
            />
            <div className="art-reference-frame panel-frame" style={frameStyle(panel, 'panel', sourceSize)}><span>{t('panelLayout')}</span></div>
            <div className="art-reference-frame side-frame" style={frameStyle(side, 'side', sourceSize)}><span>{t('sideLayout')}</span></div>
          </div>
          {failedSource === fullSource && <p className="error" role="alert">{zh ? '图片无法加载，请检查图片链接或恢复默认图片。' : 'The image could not load. Check the image URL or restore the default image.'}</p>}

          <h3>{t('livePreview')}</h3>
          <div className="art-editor-previews">
            <div><span>{t('panelLayout')}</span><CropPreview src={source} crop={panel} layout="panel" legacy={forcedLegacy} alt={heroName} /></div>
            <div><span>{t('sideLayout')}</span><CropPreview src={source} crop={side} layout="side" legacy={forcedLegacy} alt={heroName} /></div>
          </div>
        </section>
      </div>
    </dialog>,
    document.body,
  );
}
