import { describe, expect, it } from "vitest";
import { mergeLoadedConfig } from "./settingsStore";

describe("mergeLoadedConfig", () => {
  it("lets file values win over defaults", () => {
    const merged = mergeLoadedConfig({ fontSize: 20, themePreset: "violet" });
    expect(merged.fontSize).toBe(20);
    expect(merged.themePreset).toBe("violet");
  });

  it("falls back to defaults for missing fields", () => {
    const merged = mergeLoadedConfig({ fontSize: 20 });
    // untouched fields keep their defaults
    expect(merged.themePreset).toBe("cyan");
    expect(merged.contextScope).toBe("focus");
    expect(merged.execMode).toBe("confirm");
  });

  it("always forces material to solid", () => {
    const merged = mergeLoadedConfig({
      material: "acrylic" as unknown as never,
    });
    expect(merged.material).toBe("solid");
  });

  it("preserves the api key from the file (config.json is authoritative)", () => {
    const merged = mergeLoadedConfig({ aiApiKey: "sk-test-123" });
    expect(merged.aiApiKey).toBe("sk-test-123");
  });
});
