/**
 * Lightweight markdown → safe HTML for Agent bubbles.
 * Handles: paragraphs, bold, italic, inline code, fenced code, lists, links, headings.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(s: string): string {
  let t = escapeHtml(s);
  // code
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bold
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // italic
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  // links [text](url)
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return t;
}

/** Convert markdown-ish text to HTML for chat bubbles. */
export function markdownToHtml(src: string): string {
  if (!src?.trim()) return "";
  // If already looks like our sanitized HTML from earlier path, return as-is lightly
  if (/^\s*<(p|pre|ul|ol|h[1-3])[\s>]/i.test(src) && !src.includes("```")) {
    return src;
  }

  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLang = fence[1] || "";
        codeBuf = [];
      } else {
        out.push(
          `<pre class="md-pre"${codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : ""}><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeLang = "";
        codeBuf = [];
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // headings
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level} class="md-h">${inlineFormat(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // unordered list
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        out.push('<ul class="md-ul">');
      }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      i++;
      continue;
    }

    // ordered list
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        out.push('<ol class="md-ol">');
      }
      out.push(`<li>${inlineFormat(ol[1])}</li>`);
      i++;
      continue;
    }

    // blank
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    closeList();
    out.push(`<p class="md-p">${inlineFormat(line)}</p>`);
    i++;
  }

  if (inCode) {
    out.push(`<pre class="md-pre"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  closeList();
  return out.join("\n") || `<p class="md-p">${inlineFormat(src)}</p>`;
}
