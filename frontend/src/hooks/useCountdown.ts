import { useState, useEffect } from "react";

export interface CountdownState {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function calcRemaining(deadline: Date): CountdownState {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: false,
  };
}

/**
 * useCountdown — live countdown to a ballot deadline.
 *
 * @param deadline - ISO string or Date object of the ballot deadline
 * @returns { days, hours, minutes, seconds, expired }
 *
 * When `expired` becomes true the caller can re-fetch results.
 */
export function useCountdown(deadline: string | Date): CountdownState {
  const target = deadline instanceof Date ? deadline : new Date(deadline);
  const [state, setState] = useState<CountdownState>(() =>
    calcRemaining(target),
  );

  useEffect(() => {
    if (state.expired) return;

    const tick = () => setState(calcRemaining(target));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.getTime(), state.expired]);

  return state;
}
