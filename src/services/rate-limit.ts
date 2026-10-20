export function createRateLimiter(limit: number, windowMs: number) {
  const visits = new Map<string, number[]>();
  return {
    allow(key: string, now = Date.now()): boolean {
      const recent = (visits.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= limit) { visits.set(key, recent); return false; }
      recent.push(now);
      visits.set(key, recent);
      if (visits.size > 5000) for (const [id, times] of visits) if (times.every((time) => now - time >= windowMs)) visits.delete(id);
      return true;
    }
  };
}
