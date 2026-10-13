export interface LoadStats {
  count: number;
  errors: number;
  errorRate: number;
  p50: number;
  p95: number;
  max: number;
  throughputPerSec: number;
}

/** Runs `total` async tasks with at most `concurrency` in flight and returns latency statistics. */
export async function runLoad(
  total: number,
  concurrency: number,
  task: (i: number) => Promise<boolean>,
): Promise<LoadStats> {
  const latencies: number[] = [];
  let errors = 0;
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < total) {
      const i = next++;
      const t = Date.now();
      const ok = await task(i).catch(() => false);
      latencies.push(Date.now() - t);
      if (!ok) errors++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const elapsed = (Date.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
  return {
    count: total,
    errors,
    errorRate: errors / total,
    p50: pct(50),
    p95: pct(95),
    max: latencies[latencies.length - 1],
    throughputPerSec: Math.round((total / elapsed) * 10) / 10,
  };
}
