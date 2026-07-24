/** Runtime registry: paneId → recent terminal output (for Agent context with real PTY). */

const buffers = new Map<string, string[]>();
const MAX_LINES = 400;

export function appendPaneOutput(paneId: string, chunk: string) {
  const lines = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let buf = buffers.get(paneId) ?? [];
  for (const line of lines) {
    if (buf.length && lines.length === 1 && !chunk.endsWith("\n")) {
      // append to last partial line
      buf[buf.length - 1] = (buf[buf.length - 1] || "") + line;
    } else {
      buf.push(line);
    }
  }
  if (buf.length > MAX_LINES) buf = buf.slice(-MAX_LINES);
  buffers.set(paneId, buf);
}

export function getPaneOutput(paneId: string, maxLines = 80): string {
  const buf = buffers.get(paneId) ?? [];
  return buf.slice(-maxLines).join("\n");
}

export function clearPaneOutput(paneId: string) {
  buffers.delete(paneId);
}

export function setPaneOutputBanner(paneId: string, lines: string[]) {
  buffers.set(paneId, [...lines]);
}
