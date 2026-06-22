/**
 * Sanitize — Prompt 注入防护
 *
 * 所有来自 AgentMemory / 用户输入 / 外部系统的字符串在拼入 LLM prompt
 * 之前必须经过此模块清洗。防止 markdown 标题、代码块、分隔线等语法被
 * 用于 prompt injection 攻击。
 */

/**
 * 清洗 prompt 片段，移除可能被用于 prompt injection 的 markdown 控制字符。
 *
 * 规则:
 *   - 转义行首 `#` (防止伪造 markdown 标题/指令段)
 *   - 转义行首 `>` (防止伪造引用块)
 *   - 转义代码围栏标记 (```java
 *   - 移除水平分隔线 (---, ***, ___)
 *
 * 不做完整 HTML/markdown 清洗——只阻止最直接的 prompt 结构注入。
 * 输入长度为 0 或非字符串时返回空字符串。
 */
export function sanitizePromptFragment(input: string): string {
  if (!input || typeof input !== "string") return "";

  return input
    .split("\n")
    .map((line) => {
      let sanitized = line;

      // 转义 markdown 标题 (## → \##)
      sanitized = sanitized.replace(/^(#{1,6})\s/, "\\$1 ");

      // 转义引用块 (> → \>)
      sanitized = sanitized.replace(/^>\s?/, "\\> ");

      // 转义无序列表标记 + 粗体指令模式 (* → \*)
      sanitized = sanitized.replace(/^(\*{1,3})\s/, "\\$1 ");

      // 移除水平分隔线
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(sanitized.trim())) {
        return "(horizontal rule removed)";
      }

      return sanitized;
    })
    .join("\n")
    // 转义代码围栏 (``` → \`\`\`)
    .replace(/```/g, "\\`\\`\\`");
}
