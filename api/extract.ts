import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleExtract, type ExtractDeps } from "../lib/server/handleExtract.js";
import { createLimiter } from "../lib/server/rateLimit.js";
import { createAzureCaller } from "../lib/server/azure.js";

let deps: ExtractDeps | null = null;
function getDeps(): ExtractDeps {
  if (!deps) {
    deps = {
      config: {
        maxImages: Number(process.env.MAX_IMAGES) || 8,
        maxImageBytes: Number(process.env.MAX_IMAGE_BYTES) || 2_500_000,
        // Vercel functions accept ~4.5 MB request bodies; base64 adds a third.
        maxTotalBytes: Number(process.env.MAX_TOTAL_BYTES) || 3_200_000,
      },
      rateLimit: createLimiter(process.env),
      callModel: createAzureCaller(process.env),
    };
  }
  return deps;
}

function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || (req.headers["x-real-ip"] as string) || "unknown";
}

function sameOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  // Browsers always send Origin on cross-site POSTs; requests without it are not from another site's page.
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Koristi POST." });
  }
  if (!sameOrigin(req)) {
    return res.status(403).json({ error: "forbidden_origin", message: "Zahtev nije dozvoljen." });
  }
  let d: ExtractDeps;
  try {
    d = getDeps();
  } catch (e) {
    console.error("[extract] configuration error:", (e as Error).message);
    return res.status(500).json({ error: "not_configured", message: "Čitanje slika nije podešeno na serveru. Nalepi tabelu kao tekst." });
  }
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const result = await handleExtract(body, clientIp(req), d);
  for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
  return res.status(result.status).json(result.body);
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
