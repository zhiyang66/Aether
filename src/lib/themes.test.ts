import { describe, expect, it } from "vitest";
import { THEME_PRESETS, getPreset } from "./themes";

describe("themes", () => {
  it("has presets", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("getPreset falls back", () => {
    expect(getPreset("nope").id).toBe("cyan");
    expect(getPreset("violet").label).toContain("紫");
  });
});
