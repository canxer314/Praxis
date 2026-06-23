/**
 * LlmClient — DeepSeek API 实现
 *
 * 读取 .env 中的 DEEPSEEK_API_KEY。未设置时 fallback 到 mock。
 * DeepSeek API 兼容 OpenAI Chat Completions 格式。
 */

import * as fs from "fs";
import * as path from "path";
import { LlmClient, Result } from "./platform-adapter";

// ---- 读取 .env ----

function loadEnv(): Record<string, string> {
  // 优先从 cwd 读（bridge 总是在项目根目录运行）
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

// ---- DeepSeek API ----

function createDeepSeekClient(): LlmClient {
  const env = loadEnv();
  const apiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return createMockClient();
  }

  return {
    async analyze(prompt: string): Promise<Result<string>> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000); // 30s 超时

      try {
        const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-v4-flash",
            max_tokens: 4096,
            temperature: 0.1,
            messages: [{ role: "user", content: prompt }],
            thinking: { type: "disabled" },
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "");
          return { ok: false, error: { code: "LLM_ERROR", message: `API ${resp.status}: ${errText.slice(0, 100)}` } };
        }

        const data = await resp.json() as {
          choices: Array<{ message: { content: string } }>;
        };
        const text = data.choices?.[0]?.message?.content ?? "";
        return { ok: true, value: text };
      } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: { code: msg.includes("abort") ? "TIMEOUT" : "LLM_ERROR", message: msg.slice(0, 100) },
        };
      }
    },
  };
}

// ---- Mock（API key 未设置时使用，永远返回空） ----

function createMockClient(): LlmClient {
  return {
    async analyze(): Promise<Result<string>> {
      return { ok: false, error: { code: "NO_API_KEY", message: "DEEPSEEK_API_KEY 未设置，请在 .env 中配置" } };
    },
  };
}

// ---- 导出 ----

export const llmClient: LlmClient = createDeepSeekClient();
