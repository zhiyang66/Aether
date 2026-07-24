import { describe, expect, it } from "vitest";
import { extractCommandMeta, sanitizeAgentHtml } from "./sanitize";

describe("sanitizeAgentHtml", () => {
  it("escapes plain text special chars", () => {
    const html = sanitizeAgentHtml('a & "x"');
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html.startsWith("<p>")).toBe(true);
  });

  it("escapes angle brackets in plain text", () => {
    // no full tag pattern -> plain path
    const html = sanitizeAgentHtml("1 < 2 and 3 > 0");
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });

  it("strips script tags", () => {
    const html = sanitizeAgentHtml("<p>ok</p><script>alert(1)</script>");
    expect(html.toLowerCase()).not.toContain("script");
    expect(html).toContain("ok");
  });

  it("allows code and pre", () => {
    const html = sanitizeAgentHtml("<p>run</p><pre>ls</pre>");
    expect(html).toContain("<pre>");
    expect(html).toContain("ls");
    expect(html).toContain("<p>");
  });

  it("strips event handlers", () => {
    const html = sanitizeAgentHtml('<p onclick="alert(1)">x</p>');
    expect(html.toLowerCase()).not.toContain("onclick");
    expect(html).toContain("x");
  });
});

describe("extractCommandMeta", () => {
  it("parses fence and serial", () => {
    const m = extractCommandMeta("在 #3 执行\n```ps\nGet-Location\n```");
    expect(m.targetSerial).toBe(3);
    expect(m.cmd).toBe("Get-Location");
  });
});
