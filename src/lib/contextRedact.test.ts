import { describe, expect, it } from "vitest";
import { maxCharsForContextLines, redactAndTrimContext } from "./contextRedact";

describe("contextRedact", () => {
  it("redacts api keys and bearer tokens", () => {
    const t = redactAndTrimContext(
      "api_key: sk-abc1234567890xyz\nAuthorization: Bearer tok_secret_value_here\nls\n",
    );
    expect(t).toContain("***REDACTED***");
    expect(t).not.toContain("sk-abc");
    expect(t).not.toContain("tok_secret");
  });

  it("truncates long text", () => {
    const long = "a".repeat(10000);
    const t = redactAndTrimContext(long, 1000);
    expect(t.length).toBeLessThan(1100);
    expect(t).toContain("截断");
  });

  it("budgets chars from lines", () => {
    expect(maxCharsForContextLines(40)).toBeGreaterThan(1000);
    expect(maxCharsForContextLines(200)).toBeLessThanOrEqual(12000);
  });
});
