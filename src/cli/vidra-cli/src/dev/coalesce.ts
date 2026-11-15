/**
 * Wraps `task` so runs never overlap. A call made while a run is in flight
 * returns at once and schedules exactly one more run after it, however many
 * such calls arrive — the last request wins.
 */
export const coalesce = (task: () => Promise<void>): (() => Promise<void>) => {
  let running = false;
  let rerunRequested = false;

  return async () => {
    if (running) {
      rerunRequested = true;
      return;
    }
    running = true;
    try {
      do {
        rerunRequested = false;
        await task();
      } while (rerunRequested);
    } finally {
      running = false;
    }
  };
};
