/** Retry transient transport failures; leave normal browser HTTP caching intact. */
export async function fetchAssetBuffer(url, { attempts = 2, timeoutMs = 20000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${url}`);
        error.permanent = response.status < 500 && ![408, 429].includes(response.status);
        throw error;
      }
      return await response.arrayBuffer();
    } catch (error) {
      if (error.permanent || attempt + 1 >= attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Bound download/decode bursts so audio setup leaves room for the first frame. */
export async function mapConcurrent(items, concurrency, operation) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await operation(items[index], index);
    }
  }));
}
