import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Shows which settings this deployment can see (true/false only, never the values). */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim());
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    environment: process.env.VERCEL_ENV ?? "unknown",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    AZURE_OPENAI_ENDPOINT: has("AZURE_OPENAI_ENDPOINT"),
    AZURE_OPENAI_API_KEY: has("AZURE_OPENAI_API_KEY"),
    AZURE_OPENAI_DEPLOYMENT: has("AZURE_OPENAI_DEPLOYMENT"),
    AZURE_OPENAI_API_VERSION: has("AZURE_OPENAI_API_VERSION"),
    rateLimitStore: has("UPSTASH_REDIS_REST_URL") || has("KV_REST_API_URL"),
  });
}
