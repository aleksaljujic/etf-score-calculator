import { AzureOpenAI } from "openai";
import type { ImageInput } from "./handleExtract.js";

export function createAzureCaller(env: NodeJS.ProcessEnv) {
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const deployment = env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = env.AZURE_OPENAI_API_VERSION || "2024-10-21";
  if (!endpoint || !apiKey || !deployment) {
    throw new Error("Missing AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY or AZURE_OPENAI_DEPLOYMENT");
  }
  const timeoutMs = Number(env.MODEL_TIMEOUT_MS) || 55_000;
  const maxTokens = Number(env.MAX_OUTPUT_TOKENS) || 8000;
  const temperature = env.AZURE_OPENAI_TEMPERATURE !== undefined ? Number(env.AZURE_OPENAI_TEMPERATURE) : undefined;
  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment, timeout: timeoutMs, maxRetries: 0 });

  return async (prompt: string, images: ImageInput[]): Promise<string> => {
    const completion = await client.chat.completions.create({
      model: deployment,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.type};base64,${img.data}`, detail: "high" as const },
            })),
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: maxTokens,
      ...(temperature !== undefined && Number.isFinite(temperature) ? { temperature } : {}),
    });
    return completion.choices[0]?.message?.content ?? "";
  };
}
