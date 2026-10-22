import { useEffect, useRef, useState } from 'react';
import { apiURL } from '../shared/config';
import { heroesForPool, type HeroPool } from '../shared/heroPool';
import {
  summarizeAiEvaluation,
  type AiEvaluationResult,
  type AiEvaluationRow,
} from '../shared/aiEvaluation';

type Sample = { name: string; image: string; expected: number; shape: 'square' | 'circle' };
const outcomes = {
  'local-strong': '本地结果已可靠',
  'ai-used': 'AI 已采用',
  conflict: '冲突保护：保留本地',
  unavailable: 'AI 无有效结果 / 忙碌 / 超时',
};
async function readCrop(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw Error('请选择小于 8 MB 的 PNG、JPEG 或 WebP 裁图');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 384 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('浏览器无法处理图片');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

export function AiEvaluationPanel({ token, heroPool }: { token: string; heroPool: HeroPool }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [rows, setRows] = useState<AiEvaluationRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runPool, setRunPool] = useState(heroPool);
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);
  const heroes = heroesForPool(heroPool);
  const summary = summarizeAiEvaluation(rows);
  const name = (id: number | null) =>
    heroesForPool(runPool).find((h) => h.id === id)?.chineseName ?? '未识别';
  async function load(files: File[]) {
    setLoading(true);
    setMessage('');
    try {
      if (files.length > 30) throw Error('每批最多 30 张裁图');
      const next = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          image: await readCrop(file),
          expected: 0,
          shape: 'square' as const,
        })),
      );
      setSamples(next);
      setRows([]);
      setErrors([]);
      setProgress(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }
  async function run() {
    if (request.current || !samples.length) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setRows([]);
    setErrors([]);
    setProgress(0);
    setRunPool(heroPool);
    setMessage('正在评测；每张弱识别裁图最多尝试一次云端请求。');
    try {
      for (const [index, sample] of samples.entries()) {
        if (controller.signal.aborted) break;
        try {
          const response = await fetch(`${apiURL}/api/v1/ai-recognition/evaluate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: sample.image, shape: sample.shape, heroPool }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || '评测请求失败');
          if (controller.signal.aborted) break;
          setRows((current) => [
            ...current,
            { ...(data as AiEvaluationResult), name: sample.name, expected: sample.expected },
          ]);
        } catch (error) {
          if (controller.signal.aborted) break;
          setErrors((current) => [
            ...current,
            `${sample.name}：${error instanceof Error ? error.message : String(error)}`,
          ]);
        }
        setProgress(index + 1);
      }
      setMessage(
        controller.signal.aborted
          ? '已停止；保留已完成结果，当前服务端请求可能仍在结束。'
          : '评测完成。失败样本不计入准确率；AI 无有效结果按本地回退计入。',
      );
    } finally {
      request.current = undefined;
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: 1,
            createdAt: new Date().toISOString(),
            heroPool: runPool,
            summary,
            rows,
            errors,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-evaluation.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="sim-control-panel sim-ai-evaluation" aria-label="AI 效果对比实验室">
      <h2>AI 效果对比实验室 · 英雄裁图</h2>
      <p className="sim-control-note">
        先在 Control → 比赛设置配置视觉 AI。截图保留单个 Ban/Pick
        头像，上传后标注正确英雄；同一裁图分别比较本地结果和现有 AI 融合结果。测试不会修改比赛或切换
        OBS。
      </p>
      <details>
        <summary>AI 现在能做什么？怎样测试才有意义？</summary>
        <ul>
          <li>英雄：补充低置信度识别，可信冲突保留本地；仍需锁定、阶段与稳定帧校验。</li>
          <li>
            选手
            ID：转录并匹配真实名单；HUD：读取时钟、经济等七字段；赛后：读取数字。人工冻结和核验继续生效。
          </li>
          <li>
            不自动决定 MVP、胜负或 OBS 切镜。本实验室量化英雄识别，其他功能仍用对应采集流程验收。
          </li>
          <li>
            建议至少 30
            张独立截图，覆盖清晰、小头像、压缩和遮挡。避免只测重复帧；先暂停其他自动采集，减少共享
            AI 调度竞争。
          </li>
          <li>
            准确率提升用百分点表示；同时看退化数和
            P95。这里是静态裁图等待结果的时间，不代表动态视频或 OBS
            端到端延迟，也不代表人工操作节省时间。
          </li>
        </ul>
      </details>
      <label>
        1. 上传头像裁图（最多 30 张）{' '}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy || loading}
          onChange={(e) => {
            void load(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </label>
      <div className="sim-ai-samples">
        {samples.map((sample, index) => (
          <div className="sim-ai-sample" key={index}>
            <img src={sample.image} alt={`测试裁图 ${index + 1}`} />
            <span>{sample.name}</span>
            <label>
              正确英雄
              <select
                aria-label={`正确英雄 ${index + 1}`}
                disabled={busy}
                value={sample.expected}
                onChange={(e) =>
                  setSamples((current) =>
                    current.map((s, i) =>
                      i === index ? { ...s, expected: Number(e.target.value) } : s,
                    ),
                  )
                }
              >
                <option value={0}>请选择正确答案</option>
                {heroes.map((h) => (
                  <option value={h.id} key={h.id}>
                    {h.chineseName} · {h.englishName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              裁图类型
              <select
                disabled={busy}
                value={sample.shape}
                onChange={(e) =>
                  setSamples((current) =>
                    current.map((s, i) =>
                      i === index ? { ...s, shape: e.target.value as Sample['shape'] } : s,
                    ),
                  )
                }
              >
                <option value="square">Pick 方形</option>
                <option value="circle">Ban 圆形</option>
              </select>
            </label>
          </div>
        ))}
      </div>
      <div className="sim-actions">
        <button
          disabled={
            busy ||
            loading ||
            !token ||
            !samples.length ||
            samples.some((s) => !heroes.some((h) => h.id === s.expected))
          }
          onClick={() => void run()}
        >
          2. 开始配对评测（会调用已配置 AI）
        </button>
        <button disabled={!busy} onClick={() => request.current?.abort()}>
          停止评测
        </button>
        <button disabled={busy || (!rows.length && !errors.length)} onClick={download}>
          导出结果 JSON
        </button>
      </div>
      <p role="status">
        {loading ? '正在读取图片…' : message}{' '}
        {samples.length > 0 && `${progress} / ${samples.length}`}
      </p>
      <div className="sim-ai-metrics">
        <div>
          本地准确率
          <strong>
            {summary.total ? `${((summary.localCorrect / summary.total) * 100).toFixed(1)}%` : '—'}
          </strong>
        </div>
        <div>
          AI 辅助准确率
          <strong>
            {summary.total
              ? `${((summary.assistedCorrect / summary.total) * 100).toFixed(1)}%`
              : '—'}
          </strong>
        </div>
        <div>
          提升
          <strong>
            {summary.gainPoints === null ? '—' : `${summary.gainPoints.toFixed(1)} 个百分点`}
          </strong>
        </div>
        <div>
          纠正 / 退化
          <strong>
            {summary.corrected} / {summary.regressed}
          </strong>
        </div>
        <div>
          本地 / 辅助 P95
          <strong>
            {summary.localP95 === null
              ? '—'
              : `${Math.round(summary.localP95)} / ${Math.round(summary.assistedP95!)} ms`}
          </strong>
        </div>
        <div>
          AI 无结果 / 请求失败
          <strong>
            {summary.unavailable} / {errors.length}
          </strong>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="sim-ai-table">
          <table>
            <caption>完成 {rows.length} 个样本；耗时包含本地缓存影响及 AI 等待</caption>
            <thead>
              <tr>
                <th>样本</th>
                <th>正确答案</th>
                <th>本地</th>
                <th>AI 辅助</th>
                <th>采用情况</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{name(r.expected)}</td>
                  <td>
                    {r.local.heroId === r.expected ? '✓' : '✕'} {name(r.local.heroId)}
                  </td>
                  <td>
                    {r.assisted.heroId === r.expected ? '✓' : '✕'} {name(r.assisted.heroId)}
                  </td>
                  <td>{outcomes[r.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
