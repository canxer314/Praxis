/**
 * Phase 8: Claude Code JSONL transcript → 对话文本提取
 *
 * Claude Code session transcript 是 JSONL 格式，包含系统事件（mode、
 * file-history-snapshot、attachment/hook_success 等）和对话事件（user/assistant）。
 * SessionStart hook 输出可达 15KB+，占满 LLM prompt 的 8000 字符窗口。
 *
 * 本模块过滤 JSONL，提取 user/assistant/system 的 text 内容块，
 * 拼接为可读对话文本传给 LLM。
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

interface JsonlEntry {
  type?: string;
  message?: { content?: ContentBlock[] };
  content?: string | ContentBlock[];
}

interface ContentBlock {
  type: string;
  text?: string;
  content?: string;
  tool_use_id?: string;
}

// ══════════════════════════════════════════════════════════════════
// 主函数
// ══════════════════════════════════════════════════════════════════

/**
 * 将 JSONL transcript 转换为可读对话文本。
 * 过滤 user/assistant/system 条目，合并 text 块，tool_result 用长度摘要替代。
 *
 * @param raw JSONL 原始文本或纯文本（非 JSONL 时原样返回）
 * @param maxChars 截断上限，默认 8000
 */
export function convertTranscriptToDialogue(raw: string, maxChars = 8000): string {
  if (!raw || raw.trim().length === 0) return "";

  const lines = raw.replace(/\r\n/g, "\n").split("\n").filter(Boolean);

  // 非 JSONL 降级：首行不是 JSON → 原样返回（兼容 CLI --transcript 传纯文本）
  if (!looksLikeJsonl(lines)) return raw.slice(0, maxChars);

  const dialogue: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JsonlEntry;
      if (!entry.type || !entry.message?.content) continue;

      const role = entry.type;
      if (role !== "user" && role !== "assistant" && role !== "system") continue;

      const text = extractTextFromBlocks(entry.message.content);
      if (!text) continue;

      dialogue.push(text);

      // 达到上限提前退出
      if (dialogue.join("\n\n").length >= maxChars) break;
    } catch {
      continue; // 跳过非法 JSON 行
    }
  }

  return dialogue.join("\n\n").slice(0, maxChars);
}

// ══════════════════════════════════════════════════════════════════
// 内部函数
// ══════════════════════════════════════════════════════════════════

/** 判断文本是否 JSONL 格式 */
function looksLikeJsonl(lines: string[]): boolean {
  if (lines.length === 0) return false;
  try {
    JSON.parse(lines[0]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 content 块数组中提取可读文本。
 * - text 块 → 直接输出
 * - thinking 块 → 跳过（内部推理，无学习价值）
 * - tool_result 块 → [工具结果: N 字符] 摘要
 * - tool_use 块 → 跳过（工具调用参数，无用）
 * - 其他 → 安全跳过
 */
function extractTextFromBlocks(blocks: ContentBlock[]): string {
  if (!Array.isArray(blocks)) return "";

  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text && block.text.trim()) parts.push(block.text.trim());
        break;
      case "tool_result": {
        // tool_result 的文本可能嵌套在 content 字段
        const contentLen = estimateContentLength(block);
        if (contentLen > 0) parts.push(`[工具结果: ${contentLen} 字符]`);
        break;
      }
      case "thinking":
      case "tool_use":
        break; // 跳过
      default:
        break; // 未知类型, 安全跳过
    }
  }

  return parts.join("\n");
}

/** 估算 tool_result 的内容长度 */
function estimateContentLength(block: ContentBlock): number {
  const c = block.content;
  if (typeof c === "string") return c.length;
  if (Array.isArray(c)) return String(c).length;
  if (typeof block.text === "string") return block.text.length;
  return 0;
}
