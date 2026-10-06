import { describe, expect, it, vi } from "vitest";
import { handleExtract, base64Bytes, type ExtractDeps } from "../lib/server/handleExtract.js";
import { memoryLimiter } from "../lib/server/rateLimit.js";

const img = (bytes = 30) => ({ type: "image/jpeg", data: Buffer.alloc(bytes, 1).toString("base64") });
const goodReply = JSON.stringify({
  faculty: "ETF",
  rows: [{ rb: 1, name: "Matematika 1", ects: 6, grade: 9, period: "januar", acadYear: 2021, studyYear: 1, semester: "W", sureSemester: true }],
  footer: { avg: 9, ects: 6 },
});

function deps(over: Partial<ExtractDeps> = {}): ExtractDeps {
  return {
    config: { maxImages: 8, maxImageBytes: 1000, maxTotalBytes: 3000 },
    rateLimit: async () => null,
    callModel: async () => goodReply,
    ...over,
  };
}

describe("handleExtract", () => {
  it("returns normalized rows", async () => {
    const res = await handleExtract({ images: [img()] }, "ip", deps());
    expect(res.status).toBe(200);
    expect((res.body as { rows: unknown[] }).rows).toHaveLength(1);
  });
  it("rejects missing, too many, wrong type and oversize images", async () => {
    expect((await handleExtract({}, "ip", deps())).status).toBe(400);
    expect((await handleExtract({ images: Array(9).fill(img()) }, "ip", deps())).status).toBe(400);
    expect((await handleExtract({ images: [{ type: "image/gif", data: "AAAA" }] }, "ip", deps())).status).toBe(400);
    expect((await handleExtract({ images: [{ type: "image/png", data: "not base64!" }] }, "ip", deps())).status).toBe(400);
    expect((await handleExtract({ images: [img(2000)] }, "ip", deps())).status).toBe(413);
    expect((await handleExtract({ images: [img(900), img(900), img(900), img(900)] }, "ip", deps())).status).toBe(413);
  });
  it("does not call the model when rate limited", async () => {
    const callModel = vi.fn(async () => goodReply);
    const res = await handleExtract({ images: [img()] }, "ip", deps({ rateLimit: async () => 42, callModel }));
    expect(res.status).toBe(429);
    expect(res.headers?.["Retry-After"]).toBe("42");
    expect(callModel).not.toHaveBeenCalled();
  });
  it("maps model failures to 502 and empty results to 422", async () => {
    expect((await handleExtract({ images: [img()] }, "ip", deps({ callModel: async () => { throw new Error("x"); } }))).status).toBe(502);
    expect((await handleExtract({ images: [img()] }, "ip", deps({ callModel: async () => "no json" }))).status).toBe(502);
    expect((await handleExtract({ images: [img()] }, "ip", deps({ callModel: async () => '{"rows":[]}' }))).status).toBe(422);
  });
});

describe("memoryLimiter", () => {
  it("allows N requests per window, then reports the wait", async () => {
    let t = 0;
    const lim = memoryLimiter(2, 1000, () => t);
    expect(await lim("a")).toBeNull();
    expect(await lim("a")).toBeNull();
    expect(await lim("a")).toBeCloseTo(1, 5);
    expect(await lim("b")).toBeNull();
    t = 1001;
    expect(await lim("a")).toBeNull();
  });
});

describe("base64Bytes", () => {
  it("computes decoded size", () => {
    expect(base64Bytes(Buffer.alloc(10).toString("base64"))).toBe(10);
    expect(base64Bytes(Buffer.alloc(11).toString("base64"))).toBe(11);
  });
});
