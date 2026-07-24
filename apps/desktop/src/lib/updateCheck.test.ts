import { describe, expect, it } from "vitest";
import { compareVersions } from "./updateCheck";

describe("compareVersions", () => {
  it("orders major minor patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.3.0", "0.2.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("strips v prefix", () => {
    expect(compareVersions("v2.0.0", "2.0.0")).toBe(0);
  });
});
