export class BriefTimeout extends Error {
  constructor() {
    super('The AI service took too long. Completed evaluations were kept where possible; retry to reuse them. No incomplete daily brief was saved.');
    this.name = 'BriefTimeout';
  }
}

// A stalled binding must not hold the HTTP stream open indefinitely. Workers AI
// may finish an already submitted inference after we stop waiting; never start
// replacement calls in the background or save its late report.
export async function bounded(task, milliseconds, signal) {
  signal?.throwIfAborted();
  if (milliseconds <= 0) throw new BriefTimeout();
  let timer, aborted;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BriefTimeout()), milliseconds);
    aborted = () => reject(signal.reason);
    signal?.addEventListener('abort', aborted, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal?.throwIfAborted(); return task(); }), stop]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', aborted); }
}

export function transientFailure(error) {
  const message = String(error?.message || '');
  if (/quota|neuron|daily allocation|10000|unauthori[sz]ed|forbidden|401|403|429/i.test(message)) return false;
  return /overloaded|temporarily unavailable|service unavailable|bad gateway|gateway timeout|network error|fetch failed|\b50[234]\b/i.test(message);
}

export async function parallelMap(items, concurrency, signal, action, { settle = false } = {}) {
  const stopped = new AbortController();
  const active = signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal;
  const results = new Array(items.length), failures = []; let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        active.throwIfAborted();
        const index = next++;
        try { results[index] = await action(items[index], index, active); }
        catch (error) {
          if (!settle || active.aborted || /quota|neuron|daily allocation|processing limit|unauthori[sz]ed|forbidden|401|403|429/i.test(error.message)) throw error;
          failures.push(error);
        }
      }
    }));
    if (failures.length) throw failures[0];
    return results;
  } catch (error) { stopped.abort(error); throw error; }
}
