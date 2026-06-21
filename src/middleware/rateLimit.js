export function createRateLimit({
  limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60),
  windowMs = 60_000,
  now = () => Date.now()
} = {}) {
  const buckets = new Map();

  return (request, response, next) => {
    const normalizedPath = request.path.replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id"
    );
    const routeKey = `${request.method}:${normalizedPath}`;
    const bucketKey = `${request.auth.apiKey}:${routeKey}`;
    const currentTime = now();
    const existing = buckets.get(bucketKey);
    const bucket =
      existing && currentTime - existing.startedAt < windowMs
        ? existing
        : { startedAt: currentTime, count: 0 };

    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    response.set("X-RateLimit-Limit", String(limit));
    response.set("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));

    if (bucket.count > limit) {
      return response.status(429).json({
        error: "Too Many Requests",
        code: "RATE_LIMITED"
      });
    }
    return next();
  };
}
