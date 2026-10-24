import { useEffect, useState } from 'react';
import { apiURL } from '../shared/config';
import {
  carouselPages,
  type CarouselPage,
  type CarouselSnapshot,
} from '../shared/postGameCarousel';
import { PostGameBroadcast } from '../overlay/PostGameBroadcast';
import type { MatchState } from '../shared/types';
const carouselLabels: Record<CarouselPage, string> = {
  clash: '对抗路',
  mid: '中路',
  farm: '发育路',
  jungle: '打野',
  roam: '游走',
  economy: '经济对比',
};
function useCarousel(token: string) {
  const [data, setData] = useState<CarouselSnapshot>(),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(`${apiURL}/api/v1/postgame-carousel`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        });
        const value = await r.json();
        if (!r.ok) throw Error(value.error);
        setData(value);
        setError('');
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [token]);
  return { data, error, setData };
}
export function CarouselOverlay({ state, token }: { state: MatchState; token: string }) {
  const { data, error } = useCarousel(token);
  if (!data?.page || data.status === 'stopped' || data.reportId !== state.activePostGameReportId)
    return (
      <section className="pg-broadcast">
        <h1>{error || '赛后轮播待命'}</h1>
      </section>
    );
  return (
    <PostGameBroadcast
      state={state}
      mode={data.page === 'economy' ? 'progress' : 'compare'}
      compareRole={data.page === 'economy' ? undefined : data.page}
    />
  );
}
export function PostGameCarouselPanel({ token }: { token: string }) {
  const { data, error, setData } = useCarousel(token);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  async function request(method: string, body: unknown) {
    setBusy(true);
    try {
      const r = await fetch(`${apiURL}/api/v1/postgame-carousel`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const value = await r.json();
      if (!r.ok) throw Error(value.error);
      setData(value);
      setMessage('');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  const [draft, setDraft] = useState<CarouselSnapshot['config']>();
  return (
    <section className="panel postgame-carousel-panel" aria-label="赛后六类轮播">
      <h3>赛后六类数据轮播</h3>
      <p>
        对抗路 → 中路 → 发育路 → 打野 → 游走 → 经济对比。单页默认 8 秒；对位须有双方已确认位置和至少
        3 个共同可信字段。
      </p>
      <div className="toolbar">
        {(['start', 'pause', 'resume', 'previous', 'next', 'stop'] as const).map((action, i) => (
          <button
            key={action}
            className={action === 'start' ? 'primary' : undefined}
            disabled={busy || !data}
            onClick={() => void request('POST', { action })}
          >
            {['开始轮播', '暂停', '继续', '上一页', '下一页', '停止'][i]}
          </button>
        ))}
      </div>
      <p role="status">
        {data ? { stopped: '待命', running: '轮播中', paused: '已暂停' }[data.status] : '正在连接'}{' '}
        · {data?.page ? carouselLabels[data.page] : ''} {message || data?.error || error}
      </p>
      <div className="toolbar">
        {carouselPages.map((page) => (
          <button
            key={page}
            disabled={busy || !data || data.missing.includes(page)}
            onClick={() => void request('POST', { action: 'show', page })}
          >
            {carouselLabels[page]}
            {data?.missing.includes(page) ? ' · 数据缺失' : ''}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          setDraft(data?.config);
          setEditing(!editing);
        }}
      >
        设置顺序、时长与 OBS 场景
      </button>
      {editing && draft && (
        <div>
          {draft.order.map((page, index) => (
            <div className="toolbar" key={page}>
              <b>{carouselLabels[page]}</b>
              <label>
                秒
                <input
                  type="number"
                  min={2}
                  max={120}
                  value={draft.seconds[page]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      seconds: { ...draft.seconds, [page]: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <label>
                OBS 场景（可留空）
                <input
                  maxLength={128}
                  value={draft.scenes[page] || ''}
                  onChange={(e) =>
                    setDraft({ ...draft, scenes: { ...draft.scenes, [page]: e.target.value } })
                  }
                />
              </label>
              <button
                disabled={!index}
                onClick={() => {
                  const order = [...draft.order];
                  [order[index - 1], order[index]] = [order[index], order[index - 1]];
                  setDraft({ ...draft, order });
                }}
              >
                上移
              </button>
            </div>
          ))}
          <label>
            结束切换场景
            <input
              value={draft.endScene}
              maxLength={128}
              onChange={(e) => setDraft({ ...draft, endScene: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.skipMissing}
              onChange={(e) => setDraft({ ...draft, skipMissing: e.target.checked })}
            />
            跳过缺失数据
          </label>
          <button disabled={busy} onClick={() => void request('PUT', draft)}>
            保存轮播设置
          </button>
        </div>
      )}
      <a href="/overlay/postgame-carousel" target="_blank" rel="noreferrer">
        统一轮播 Overlay · 1920×1080（无需为每页切镜）
      </a>
    </section>
  );
}
