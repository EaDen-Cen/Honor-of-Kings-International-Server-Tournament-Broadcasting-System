import { useEffect, useState } from 'react';
import type { StrictCandidate } from './strictVote';
import { VoteCountdown } from './VoteCountdown';
interface PublicBallot {
  id: string;
  gameNumber: number;
  candidates: StrictCandidate[];
  deadline: number;
  serverNow: number;
  status: string;
}
export function PublicVote() {
  const id = location.pathname.split('/').at(-1)!;
  const [data, setData] = useState<PublicBallot>(),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  useEffect(() => {
    let stopped = false;
    const abort = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(`/api/v1/public-votes/${id}`, { signal: abort.signal });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        if (!stopped) {
          setData(result);
          setError('');
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : 'Connection failed');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      stopped = true;
      abort.abort();
      clearInterval(timer);
    };
  }, [id]);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      let voter = localStorage.getItem('hok-voter-id');
      if (!voter) {
        voter = crypto.randomUUID();
        localStorage.setItem('hok-voter-id', voter);
      }
      const response = await fetch(`/api/v1/public-votes/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voter, rowId: selected }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setData(result);
      setAccepted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', padding: 20 }}>
      <h1>观众 MVP / Audience MVP {data && `· GAME ${data.gameNumber}`}</h1>
      <p>
        匿名投票：每个浏览器限一票。清除存储或更换设备可绕过限制，不能保证一人一票。最终 MVP
        由导播核实。
        <br />
        Anonymous browser ballot; not verified one-person-one-vote. Operator confirms the final MVP.
      </p>
      {data && (
        <>
          <p>
            {data.status === 'active'
              ? '投票中 / Voting'
              : data.status === 'cancelled'
                ? '已取消，票数作废 / Cancelled, ballots void'
                : '已截止 / Closed'}{' '}
            ·{' '}
            <VoteCountdown
              deadline={data.deadline}
              serverNow={data.serverNow}
              active={data.status === 'active'}
            />
          </p>
          <fieldset disabled={busy || accepted || data.status !== 'active'}>
            <legend>选择一名选手 / Choose one player</legend>
            {data.candidates.map((c) => (
              <label key={c.rowId} style={{ display: 'block', padding: 12 }}>
                <input
                  type="radio"
                  name="candidate"
                  value={c.rowId}
                  checked={selected === c.rowId}
                  onChange={() => setSelected(c.rowId)}
                />{' '}
                {c.team} · {c.name}
              </label>
            ))}
          </fieldset>
          <button
            disabled={busy || accepted || !selected || data.status !== 'active'}
            onClick={() => void submit()}
          >
            提交投票 / Submit vote
          </button>
        </>
      )}
      <p role="status">{accepted ? '已记录 / Vote recorded' : error}</p>
    </main>
  );
}
