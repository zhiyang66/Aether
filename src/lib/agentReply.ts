/**
 * Split assistant raw text into thinking vs user-facing answer,
 * and strip internal tool JSON from the visible bubble.
 */

export type SplitReply = {
  thinking: string;
  answer: string;
};

const THINK_TAG =
  /<(?:think|thinking|reasoning|redacted_reasoning)>\s*([\s\S]*?)\s*<\/(?:think|thinking|reasoning|redacted_reasoning)>/gi;

/** OpenAI-style JSON actions fence — keep for parsing, hide from bubble. */
const ACTIONS_FENCE =
  /```(?:json)?\s*\n?\s*(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\})\s*\n?```/gi;

export function splitAgentReply(raw: string, streamedReasoning = ""): SplitReply {
  let text = (raw || "").replace(/\r\n/g, "\n");
  const thinkParts: string[] = [];

  if (streamedReasoning.trim()) {
    thinkParts.push(streamedReasoning.trim());
  }

  text = text.replace(THINK_TAG, (_m, inner: string) => {
    if (inner?.trim()) thinkParts.push(inner.trim());
    return "\n";
  });

  // Grok / some models dump English chain-of-thought then Chinese answer without tags
  const cot = peelLeadingMonologue(text);
  if (cot.thinking) {
    thinkParts.push(cot.thinking);
    text = cot.answer;
  }

  // Remove actions JSON from visible answer (still parseable from raw elsewhere)
  text = text.replace(ACTIONS_FENCE, "").trim();

  // Collapse excess blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  const thinking = thinkParts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { thinking, answer: text };
}

/**
 * If the reply starts with English internal monologue and then a CJK / clean answer,
 * peel the monologue into thinking.
 */
function peelLeadingMonologue(text: string): SplitReply {
  const t = text.trim();
  if (!t) return { thinking: "", answer: "" };

  // Already mostly Chinese from the start — keep as answer
  if (/^[一-鿿]/.test(t) || /^[#>`*\-\d]/.test(t)) {
    return { thinking: "", answer: t };
  }

  // Heuristic: first 1–3 paragraphs look like English reasoning about the user
  const monoHints =
    /\b(I (am|should|will|need|can)|The user (said|is|wants|asked)|Let me|Looking at|Based on|As an AI|Aether Agent)\b/i;
  if (!monoHints.test(t.slice(0, 400))) {
    return { thinking: "", answer: t };
  }

  // Split at first strong CJK paragraph start after some English
  const lines = t.split("\n");
  let cut = -1;
  let sawEnglish = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cjkRatio = cjkCharRatio(line);
    if (cjkRatio < 0.2 && /[A-Za-z]{3,}/.test(line)) {
      sawEnglish = true;
      continue;
    }
    if (sawEnglish && cjkRatio >= 0.35) {
      cut = i;
      break;
    }
    // Markdown heading / list after monologue
    if (sawEnglish && /^(#{1,3}\s|[-*+]\s|\d+\.\s)/.test(line) && cjkRatio >= 0.2) {
      cut = i;
      break;
    }
  }

  if (cut > 0) {
    return {
      thinking: lines.slice(0, cut).join("\n").trim(),
      answer: lines.slice(cut).join("\n").trim(),
    };
  }

  // No clear Chinese block — if entire thing is English monologue-heavy, still show as answer
  // (don't hide the only content)
  return { thinking: "", answer: t };
}

function cjkCharRatio(s: string): number {
  if (!s.length) return 0;
  let cjk = 0;
  let letters = 0;
  for (const ch of s) {
    if (/[一-鿿]/.test(ch)) cjk++;
    else if (/[A-Za-z]/.test(ch)) letters++;
  }
  const den = cjk + letters;
  return den ? cjk / den : 0;
}
