import { useEffect, useState } from 'react';
/** Anchor elapsed time to the server response, never the device wall clock. */
export function VoteCountdown({
  deadline,
  serverNow,
  active,
}: {
  deadline: number;
  serverNow: number;
  active: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const received = performance.now();
    const update = () =>
      setSeconds(
        active
          ? Math.max(0, Math.ceil((deadline - serverNow - (performance.now() - received)) / 1000))
          : 0,
      );
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline, serverNow, active]);
  return (
    <span aria-label="服务器倒计时 / Server countdown">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}
