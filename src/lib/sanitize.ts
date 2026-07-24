/**
 * Minimal HTML sanitizer for Agent assistant bubbles.
 * Prefer DOM when available; regex fallback for Node tests / SSR.
 */

const ALLOWED = new Set([
  "p",
  "br",
  "code",
  "pre",
  "em",
  "strong",
  "b",
  "i",
  "ul",
  "ol",
  "li",
  "span",
  "a",
]);

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Sanitize assistant HTML to a safe subset. */
export function sanitizeAgentHtml(input: string): string {
  if (!input) return "";

  // Fast path: no HTML tags at all
  if (!/<[a-zA-Z/!]/.test(input)) {
    return `<p>${escapeText(input).replace(/\n/g, "<br/>")}</p>`;
  }

  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(
        `<div id="sw-root">${input}</div>`,
        "text/html",
      );
      const root = doc.getElementById("sw-root");
      if (root) {
        const out = serializeSafe(root);
        if (out.trim()) return out;
      }
    } catch {
      /* fall through */
    }
  }

  return sanitizeByRegex(input);
}

function serializeSafe(node: Node): string {
  if (node.nodeType === 3 /* TEXT */) {
    return escapeText(node.textContent || "");
  }
  if (node.nodeType !== 1 /* ELEMENT */) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object") {
    return "";
  }

  // Unwrap unknown containers (div from root)
  if (tag === "div" || !ALLOWED.has(tag)) {
    let out = "";
    el.childNodes.forEach((c) => {
      out += serializeSafe(c);
    });
    return out;
  }

  if (tag === "br") return "<br/>";

  let attrs = "";
  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    if (/^(https?:|mailto:|#)/i.test(href)) {
      attrs += ` href="${escapeText(href)}"`;
    }
  }
  if (tag === "span") {
    const style = el.getAttribute("style") || "";
    if (/color\s*:/i.test(style) && !/expression|url\s*\(/i.test(style)) {
      attrs += ` style="${escapeText(style)}"`;
    }
  }

  let inner = "";
  el.childNodes.forEach((c) => {
    inner += serializeSafe(c);
  });
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/** Regex fallback when DOMParser is unavailable. */
function sanitizeByRegex(input: string): string {
  let s = input
    // drop scripts / styles entirely
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Keep only allowed tags; strip attributes except simple ones later
  s = s.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (full, rawTag: string, attrs?: string) => {
    const tag = rawTag.toLowerCase();
    const closing = full.startsWith("</");
    if (!ALLOWED.has(tag)) return "";
    if (tag === "br") return "<br/>";
    if (closing) return `</${tag}>`;
    if (tag === "a" && attrs) {
      const m = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = m ? m[2] || m[3] || m[4] || "" : "";
      if (/^(https?:|mailto:|#)/i.test(href)) {
        return `<a href="${escapeText(href)}">`;
      }
      return "<a>";
    }
    return `<${tag}>`;
  });

  // Escape any leftover bare < that aren't tags we rewrote (best effort)
  return s;
}

/** Extract fenced command + optional #N from model text. */
export function extractCommandMeta(text: string): {
  cmd?: string;
  targetSerial?: number;
} {
  const serialMatch = text.match(/#(\d+)/);
  const cmdMatch = text.match(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/);
  return {
    cmd: cmdMatch?.[1]?.trim(),
    targetSerial: serialMatch ? Number(serialMatch[1]) : undefined,
  };
}
