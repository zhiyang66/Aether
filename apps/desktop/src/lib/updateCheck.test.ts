import { describe, expect, it } from "vitest";
import {
  compareVersions,
  parseUpdatePayload,
  resolveUpdateFeedUrl,
  DEFAULT_UPDATE_FEED,
} from "./updateCheck";

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

describe("resolveUpdateFeedUrl", () => {
  it("defaults empty/github to GitHub latest", () => {
    expect(resolveUpdateFeedUrl("")).toBe(DEFAULT_UPDATE_FEED);
    expect(resolveUpdateFeedUrl("  ")).toBe(DEFAULT_UPDATE_FEED);
    expect(resolveUpdateFeedUrl("github")).toBe(DEFAULT_UPDATE_FEED);
    expect(resolveUpdateFeedUrl("default")).toBe(DEFAULT_UPDATE_FEED);
  });

  it("disables with off/none", () => {
    expect(resolveUpdateFeedUrl("off")).toBeNull();
    expect(resolveUpdateFeedUrl("none")).toBeNull();
    expect(resolveUpdateFeedUrl("disabled")).toBeNull();
  });

  it("passes through custom URLs", () => {
    expect(resolveUpdateFeedUrl("https://example.com/v.json")).toBe(
      "https://example.com/v.json",
    );
  });
});

describe("parseUpdatePayload", () => {
  it("parses version.json", () => {
    const r = parseUpdatePayload(
      { version: "v1.2.3", notes: "hi", url: "https://x" },
      "https://feed",
    );
    expect(r).toEqual({ version: "1.2.3", notes: "hi", url: "https://x" });
  });

  it("parses GitHub release object", () => {
    const r = parseUpdatePayload(
      {
        tag_name: "v1.0.2",
        body: "notes here",
        html_url: "https://github.com/zhiyang66/Aether/releases/tag/v1.0.2",
        assets: [
          {
            name: "Aether_1.0.2_x64-setup.exe",
            browser_download_url:
              "https://github.com/zhiyang66/Aether/releases/download/v1.0.2/Aether_1.0.2_x64-setup.exe",
          },
        ],
      },
      "https://api.github.com/repos/zhiyang66/Aether/releases/latest",
    );
    expect(r.version).toBe("1.0.2");
    expect(r.notes).toContain("notes");
    expect(r.url).toContain("releases/tag/v1.0.2");
  });
});
