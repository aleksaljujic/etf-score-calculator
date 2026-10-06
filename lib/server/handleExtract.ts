import { buildPrompt, normalizeExtraction, parseModelJson } from "../extract.js";
import type { ExtractResponse } from "../types.js";

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ExtractConfig {
  maxImages: number;
  maxImageBytes: number;
  maxTotalBytes: number;
}

export interface ImageInput { type: string; data: string }

export interface ExtractDeps {
  config: ExtractConfig;
  /** Returns null when allowed, or seconds to wait when limited. */
  rateLimit: (key: string) => Promise<number | null>;
  /** Calls the vision model; returns its raw text reply. */
  callModel: (prompt: string, images: ImageInput[]) => Promise<string>;
}

export interface HandlerResult {
  status: number;
  body: ExtractResponse | { error: string; message: string };
  headers?: Record<string, string>;
}

const err = (status: number, error: string, message: string, headers?: Record<string, string>): HandlerResult =>
  ({ status, body: { error, message }, headers });

export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

export async function handleExtract(body: unknown, clientKey: string, deps: ExtractDeps): Promise<HandlerResult> {
  const { config } = deps;
  const images = (body as { images?: unknown } | null)?.images;
  if (!Array.isArray(images) || images.length === 0) {
    return err(400, "no_images", "Nije poslata nijedna slika.");
  }
  if (images.length > config.maxImages) {
    return err(400, "too_many_images", `Najviše ${config.maxImages} slika po zahtevu.`);
  }
  let total = 0;
  const clean: ImageInput[] = [];
  for (const img of images) {
    const type = (img as ImageInput)?.type;
    const data = (img as ImageInput)?.data;
    if (typeof type !== "string" || !(ALLOWED_TYPES as readonly string[]).includes(type)) {
      return err(400, "bad_type", "Dozvoljene su samo PNG, JPG i WebP slike.");
    }
    if (typeof data !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
      return err(400, "bad_data", "Slika nije ispravno poslata.");
    }
    const bytes = base64Bytes(data);
    if (bytes > config.maxImageBytes) return err(413, "image_too_large", "Slika je prevelika. Pokušaj sa kraćim snimkom ekrana.");
    total += bytes;
    clean.push({ type, data: data.replace(/\s/g, "") });
  }
  if (total > config.maxTotalBytes) return err(413, "too_large", "Slike su ukupno prevelike. Pokušaj sa kraćim snimkom ekrana.");

  const wait = await deps.rateLimit(clientKey);
  if (wait !== null) {
    return err(429, "rate_limited", "Previše zahteva. Pokušaj ponovo za nekoliko minuta.", { "Retry-After": String(Math.max(1, Math.ceil(wait))) });
  }

  let reply: string;
  try {
    reply = await deps.callModel(buildPrompt(), clean);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "AbortError" || name === "APIConnectionTimeoutError") {
      return err(502, "timeout", "Čitanje je trajalo predugo. Pokušaj ponovo ili pošalji kraći snimak ekrana.");
    }
    // Surface Azure's status/code (never secrets) so configuration problems can be fixed.
    const status = (e as { status?: number })?.status;
    const code = (e as { code?: string; error?: { code?: string } })?.code ?? (e as { error?: { code?: string } })?.error?.code;
    console.error("[extract] model call failed:", status, code, (e as Error)?.message);
    const detail = [status, code].filter(Boolean).join(" ");
    return err(502, "upstream_error", `Servis za čitanje slika trenutno ne radi${detail ? ` (Azure: ${detail})` : ""}. Pokušaj ponovo ili nalepi tabelu kao tekst.`);
  }

  let parsed: unknown;
  try {
    parsed = parseModelJson(reply);
  } catch {
    return err(502, "invalid_json", "Odgovor nije mogao da se pročita. Pokušaj ponovo sa jasnijim snimkom ekrana.");
  }
  const result = normalizeExtraction(parsed);
  if (!result.rows.length) {
    return err(422, "no_rows", "Na slici nije pronađen nijedan ispit. Proveri da se vidi tabela položenih ispita.");
  }
  return { status: 200, body: result };
}
