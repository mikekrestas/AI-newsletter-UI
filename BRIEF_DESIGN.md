# Daily brief reliability — 12 October 2026

The owner reported recurring failures around 24 seconds after the latency fix. That matches the old 22-second evaluation deadline plus collection/transport overhead; it does not prove the precise latency of their Cloudflare inference. No production credentials or private inbox were available for this investigation.

## Decision

Reduce model calls before adding infrastructure. Keep the existing free Workers AI model, Worker and private KV. The current [model documentation](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/) lists a **32,000-token context**. Small days can therefore be compared and written together; larger days can be packed into complete, bounded text batches rather than invoking the model for every edition.

| Approach | Benefit | Limitation / decision |
| --- | --- | --- |
| Increase deadlines alone | Stops premature failure | Does not reduce inference work; insufficient on its own |
| Remove caching | Simpler storage | Repeats all completed work after errors or new arrivals; rejected |
| Per-edition calls plus cache | Fine-grained reuse | Too many cold calls and separate output generations; replaced with batch reuse |
| Full-day pass, bounded batching when larger | Fewer round trips/output generations; direct comparison across sources | Batch edits can invalidate other editions in that batch; selected |
| Smaller or different model | Potentially lower latency | No live evidence of faster inference or comparable news judgement; retain existing model |
| Durable background Workflows | Can persist/retry a job across closed tabs | Available on the [Free plan](https://developers.cloudflare.com/workflows/reference/pricing/), but adds job state, bindings and deployment changes without reducing inference itself; defer unless background completion is required |
| Scheduled/preloaded reports | Fast reads once generated | Spends allowance for dates never opened and needs server-side collection/scheduling; outside this fix |

## Execution and recovery

- All supplied full text is preserved, including Unicode and the last paragraphs. Batches contain at most 22,000 UTF-8 bytes of text, metadata and reference catalogue. System prompt and output allowance are checked against context too. No model switch or unsupported JSON-mode parameter is introduced.
- One batch goes directly to the final editor. Multiple batches evaluate at most four at a time, return validated ranked candidates, and share equal per-provider maximum budgets before final writing. The final response includes its short overview, avoiding a separate prose call when valid. If highlights are rejected, their overview is not accepted; a replacement sees only retained highlights.
- Four AI calls leave headroom under the documented [six simultaneous outgoing connections](https://developers.cloudflare.com/workers/platform/limits/). This is a conservative scheduling choice, not proof of the account's internal model concurrency.
- Explicit temporary service/network failures get one bounded retry with backoff. Unknown failures, quota/auth rejection and client-side timeouts do not cause speculative overlapping inference. Malformed candidate batches get one local formatting repair. Successful siblings finish/cache even if another fails.
- The 30–40-second target is separate from the recovery ceiling: 60 seconds per call, 135 seconds overall AI, 150 seconds browser including collection. Calls/repairs share the overall budget. A stalled optional overview cannot discard usable highlights. A stalled final writer can use the existing labelled original-headline digest only after all batches have been evaluated.
- Cache keys include owner/label identity, editorial version, model, full batch content and article metadata. Keys hash the input; persisted values contain candidate notes, never raw newsletter bodies. Local reference keys remap by exact URL. Appending an edition normally changes only the last batch; reordering input does not corrupt links.
- [KV is eventually consistent, including negative reads](https://developers.cloudflare.com/kv/concepts/how-kv-works/). The 30-day KV cache is supplemented by at most 128 write-through entries for 15 minutes in a live isolate. This helps immediate retries; it is neither a distributed lock nor a promise of immediate cross-device visibility.
- No background job is promised: `waitUntil` is not durable execution and only has limited time after disconnect. Keep the app open; retries reuse completed batches where available. Opening/refreshing saved reports never spends AI allowance.

## Quality and verification

The existing selection criteria remain: consequential developments, evidence, practical impact, no advertising/filler, no detached experimental statistics, and preserved internal/preliminary caveats. Every highlight must point to a known specific article URL. Model text remains untrusted and structurally validated. Complete input coverage is not a requirement to select a story from every provider, and structural tests do not independently prove factual correctness or editorial judgement.

Regression fixtures cover whole-input/context bounds, 5/10/15/20 editions, link remapping, changed inputs, quiet days, malformed batches, ten varied-latency runs with injected recoverable failures, quotas, cancellation, hanging calls, successful siblings after failure, stale KV misses, cache isolation/expiry/eviction, and overview grounding. Browser tests exercise mobile continuation beyond 40 seconds, completion after that target and a recoverable terminal timeout. Timing tests use simulated AI, not real inboxes or Cloudflare inference; production latency, neuron use and editorial quality must be checked after deployment. The [free daily allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/) remains a hard external limit, with no paid fallback.

A separate wall-clock fixture used 20 full editions, three parallel evaluation batches delayed 2/9/26 seconds and a 2-second writer. It completed in **28.032 seconds with four calls**, including the evaluation that exceeded the former 22-second cutoff. Reusing the three batches took **2.006 seconds with one writing call**. These fixed artificial delays demonstrate scheduling/reuse; they do not predict model latency, token throughput or neuron cost. Syntax, 47 backend/deployment tests, seven Chromium suites and a Worker dry run passed.
