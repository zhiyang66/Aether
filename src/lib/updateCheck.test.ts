import { describe, expect, it } from "vitest";
import {
  compareVersions,
  parseUpdatePayload,
  resolveUpdateFeedUrl,
  DEFAULT_UPDATE_FEED,
  FALLBACK_VERSION_JSON,
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
  it("defaults empty/github to GitHub releases/latest page", () => {
    expect(resolveUpdateFeedUrl("")).toBe(DEFAULT_UPDATE_FEED);
    expect(resolveUpdateFeedUrl("github")).toBe(DEFAULT_UPDATE_FEED);
    expect(DEFAULT_UPDATE_FEED).toContain("github.com/zhiyang66/Aether/releases/latest");
    expect(DEFAULT_UPDATE_FEED).not.toContain("api.github.com");
  });

  it("disables with off/none", () => {
    expect(resolveUpdateFeedUrl("off")).toBeNull();
    expect(resolveUpdateFeedUrl("none")).toBeNull();
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

  it("parses the direct installer fields from version.json", () => {
    const r = parseUpdatePayload(
      {
        version: "1.2.3",
        download_url: "https://github.com/zhiyang66/Aether/releases/download/v1.2.3/Aether_1.2.3_x64-setup.exe",
        download_name: "Aether_1.2.3_x64-setup.exe",
      },
      "https://feed",
    );
    expect(r.downloadUrl).toContain("/releases/download/");
    expect(r.downloadName).toBe("Aether_1.2.3_x64-setup.exe");
  });

  it("parses GitHub releases/latest JSON (github.com, not API)", () => {
    const r = parseUpdatePayload(
      {
        tag_name: "v1.0.3",
        html_url: "https://github.com/zhiyang66/Aether/releases/tag/v1.0.3",
      },
      DEFAULT_UPDATE_FEED,
    );
    expect(r.version).toBe("1.0.3");
    expect(r.url).toContain("releases/tag/v1.0.3");
  });

  it("fallback constant points at raw version.json", () => {
    expect(FALLBACK_VERSION_JSON).toContain("raw.githubusercontent.com");
    expect(FALLBACK_VERSION_JSON).toContain("version.json");
  });
});
