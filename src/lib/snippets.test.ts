import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSnippet,
  extractParams,
  importSnippetsJson,
  isValidSnippet,
  loadSnippets,
  newSnippetId,
  renderSnippet,
  SNIPPETS_KEY,
  snippetsForShell,
  upsertSnippet,
  type Snippet,
} from "./snippets";

const snip = (over: Partial<Snippet> = {}): Snippet => ({
  id: newSnippetId(),
  name: "test",
  template: "echo {msg}",
  params: [{ name: "msg", default: "hi" }],
  ...over,
});

beforeEach(() => localStorage.removeItem(SNIPPETS_KEY));

describe("renderSnippet", () => {
  it("substitutes provided values", () => {
    expect(renderSnippet(snip(), { msg: "hello" })).toBe("echo hello");
  });

  it("falls back to param default, then literal placeholder", () => {
    expect(renderSnippet(snip())).toBe("echo hi");
    const s = snip({ template: "git tag {ver}", params: [{ name: "ver" }] });
    expect(renderSnippet(s)).toBe("git tag {ver}");
  });

  it("substitutes repeated placeholders", () => {
    const s = snip({ template: "{a} and {a}", params: [{ name: "a" }] });
    expect(renderSnippet(s, { a: "x" })).toBe("x and x");
  });
});

describe("extractParams", () => {
  it("returns unique names in order", () => {
    expect(extractParams("scp {src} {host}:{src}")).toEqual(["src", "host"]);
  });
  it("ignores non-identifier braces (awk bodies, empty braces)", () => {
    expect(extractParams("awk '{print $1}'")).toEqual([]);
    expect(extractParams("echo {}")).toEqual([]);
  });
});

describe("store CRUD + filters", () => {
  it("upsert / delete round-trip", () => {
    const s = snip();
    upsertSnippet(s);
    expect(loadSnippets()).toHaveLength(1);
    upsertSnippet({ ...s, name: "renamed" });
    expect(loadSnippets()).toHaveLength(1);
    expect(loadSnippets()[0].name).toBe("renamed");
    deleteSnippet(s.id);
    expect(loadSnippets()).toHaveLength(0);
  });

  it("snippetsForShell matches universal, exact and wsl-prefixed keys", () => {
    upsertSnippet(snip({ id: "a", shellKeys: undefined }));
    upsertSnippet(snip({ id: "b", shellKeys: ["ps"] }));
    upsertSnippet(snip({ id: "c", shellKeys: ["wsl"] }));
    const forPs = snippetsForShell("ps").map((s) => s.id);
    expect(forPs).toContain("a");
    expect(forPs).toContain("b");
    expect(forPs).not.toContain("c");
    expect(snippetsForShell("wsl:Ubuntu-24.04").map((s) => s.id)).toContain("c");
  });

  it("import merges by id and rejects invalid entries", () => {
    upsertSnippet(snip({ id: "keep", name: "old" }));
    const n = importSnippetsJson(
      JSON.stringify([
        { id: "keep", name: "new", template: "ls", params: [] },
        { id: "bad", name: "", template: "", params: [] },
      ]),
    );
    expect(n).toBe(1);
    expect(loadSnippets().find((s) => s.id === "keep")?.name).toBe("new");
  });

  it("isValidSnippet rejects malformed shapes", () => {
    expect(isValidSnippet(null)).toBe(false);
    expect(isValidSnippet({ id: "x", name: "n", template: "t" })).toBe(false);
    expect(
      isValidSnippet({ id: "x", name: "n", template: "t", params: [] }),
    ).toBe(true);
  });
});
