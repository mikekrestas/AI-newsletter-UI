// KV is eventually consistent, including negative reads. Keep a small,
// owner-scoped write-through cache in this isolate so an immediate retry need
// not wait for replication. It is an optimisation, never a lock or job queue.
const instances = new WeakMap();
export function evaluationCache(store, identity, hash, context) {
  if (!instances.has(store)) instances.set(store, new Map());
  const memory = instances.get(store);
  const keyFor = async input => `evaluation:${identity}:${await hash(input)}`;
  function remember(key, value) {
    memory.delete(key);
    memory.set(key, { value: structuredClone(value), expires: Date.now() + 15 * 60000 });
    while (memory.size > 128) memory.delete(memory.keys().next().value);
  }
  return {
    async get(input) {
      const key = await keyFor(input), cached = memory.get(key);
      if (cached?.expires > Date.now()) return structuredClone(cached.value);
      memory.delete(key);
      const value = await store.get(key, 'json');
      // Validation is done by the evaluator before using any persisted value.
      return value;
    },
    async put(input, value) {
      const key = await keyFor(input);
      remember(key, value);
      const write = store.put(key, JSON.stringify(value), { expirationTtl: 30 * 86400 });
      context?.waitUntil(write.catch(() => {}));
      await write;
    }
  };
}
