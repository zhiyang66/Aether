import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
  it("renders bold and code", () => {
    const h = markdownToHtml("你在 **#2**，路径 `C:\\a`");
    expect(h).toContain("<strong>");
    expect(h).toContain("<code>");
  });

  it("renders fenced code", () => {
    const h = markdownToHtml("```ps\nGet-Location\n```");
    expect(h).toContain("<pre");
    expect(h).toContain("Get-Location");
  });

  it("renders lists", () => {
    const h = markdownToHtml("- a\n- b");
    expect(h).toContain("<ul");
    expect(h).toContain("<li>");
  });
});
