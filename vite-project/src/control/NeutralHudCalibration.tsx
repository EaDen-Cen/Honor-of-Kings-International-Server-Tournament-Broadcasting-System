import { useState } from 'react';
import { CaptureRegionPicker } from './CaptureRegionPicker';
import { neutralObjectiveLabel, type NeutralObjective } from '../shared/liveGame';
import { validNeutralRegions, type NeutralRegion } from '../shared/neutralRecognition';

export function NeutralHudCalibration({
  zh,
  objectives,
  preview,
  regions,
  onChange,
  approved,
  onApprove,
}: {
  zh: boolean;
  objectives: NeutralObjective[];
  preview: string;
  regions: NeutralRegion[];
  onChange: (regions: NeutralRegion[]) => void;
  approved: boolean;
  onApprove: () => void;
}) {
  const choices = objectives.flatMap((item) =>
    (['blue', 'red'] as const).map((side) => ({ id: JSON.stringify([item.id, side]), item, side })),
  );
  const [selected, setSelected] = useState('');
  const choice = choices.find((c) => c.id === selected) ?? choices[0];
  return (
    <details>
      <summary>
        {zh
          ? '中立资源累计数识别（需单独校准）'
          : 'Neutral objective counters (separate calibration)'}
      </summary>
      <p className="muted">
        {zh
          ? '只框选对应种类、对应阵营的累计数字。存活提示、倒计时、击杀横幅和总计不能当作某一种资源计数。画面无分类累计数字时保留人工输入，不猜测。确认后，在资源面板解除对应计数的冻结。'
          : 'Select only visible cumulative digits for the exact objective and side. Presence, timers, banners and aggregate totals are not category counters. Without category counters, use manual input. After calibration, resume the corresponding counters in the objective panel.'}
      </p>
      <select
        aria-label="Objective calibration field"
        value={choice?.id ?? ''}
        onChange={(e) => setSelected(e.target.value)}
      >
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {neutralObjectiveLabel(c.item, zh)} ·{' '}
            {c.side === 'blue' ? (zh ? '蓝方' : 'Blue') : zh ? '红方' : 'Red'}
          </option>
        ))}
      </select>
      <button
        disabled={
          !choice || !regions.some((r) => r.id === choice.item.id && r.side === choice.side)
        }
        onClick={() =>
          onChange(regions.filter((r) => r.id !== choice?.item.id || r.side !== choice?.side))
        }
      >
        {zh ? '移除此选框' : 'Remove selected region'}
      </button>
      <button disabled={!preview || !validNeutralRegions(regions)} onClick={onApprove}>
        {zh ? '确认是对应资源的累计数字' : 'Confirm these are the matching cumulative counters'}
      </button>
      <strong>
        {approved
          ? zh
            ? '已确认'
            : 'Confirmed'
          : zh
            ? '未确认 · 仅人工输入'
            : 'Not approved · manual input only'}
      </strong>
      {preview && choice && (
        <CaptureRegionPicker
          image={preview}
          label="Objective counter selection"
          zh={zh}
          selected={choice.id}
          regions={choices.map((c) => ({
            id: c.id,
            label: `${neutralObjectiveLabel(c.item, zh)} ${c.side}`,
            region: regions.find((r) => r.id === c.item.id && r.side === c.side)?.region,
          }))}
          onChange={(region) =>
            onChange([
              ...regions.filter((r) => r.id !== choice.item.id || r.side !== choice.side),
              { id: choice.item.id, side: choice.side, region },
            ])
          }
        />
      )}
      {!preview && (
        <p>
          {zh
            ? '请先在七字段校准中预览当前帧。'
            : 'Preview a current frame in the seven-field calibration first.'}
        </p>
      )}
    </details>
  );
}
