import { SHELLS, guessHomeDir } from "./shells";

export type TermLine = { cls?: string; text: string; clear?: boolean };

/** shellKey is catalog key: ps | bash | zsh | cmd | wsl | wsl:Ubuntu-24.04 */
export type LeafPane = {
  type: "leaf";
  id: string;
  serial: number;
  shellKey: string;
  /** optional scanned profile id for exact path/args */
  profileId?: string;
  cwd: string;
  history: TermLine[];
  cmdHistory: string[];
  histIdx: number;
  draft: string;
  ptyId?: string;
};

export type SplitNode = {
  type: "split";
  id: string;
  dir: "h" | "v";
  ratio: number;
  a: LayoutNode;
  b: LayoutNode;
};

export type LayoutNode = LeafPane | SplitNode;

export type Tab = {
  id: string;
  title: string;
  shellKey: string;
  profileId?: string;
  layout: LayoutNode;
  activePaneId: string;
};

export const MAX_PANES = 6;

export function collectLeaves(node: LayoutNode | null | undefined, out: LeafPane[] = []): LeafPane[] {
  if (!node) return out;
  if (node.type === "leaf") {
    out.push(node);
  } else {
    collectLeaves(node.a, out);
    collectLeaves(node.b, out);
  }
  return out;
}

export function countLeaves(node: LayoutNode | null | undefined): number {
  return collectLeaves(node).length;
}

export function findLeaf(node: LayoutNode | null | undefined, paneId: string): LeafPane | null {
  if (!node) return null;
  if (node.type === "leaf") return node.id === paneId ? node : null;
  return findLeaf(node.a, paneId) || findLeaf(node.b, paneId);
}

export function findLeafBySerial(node: LayoutNode | null | undefined, serial: number): LeafPane | null {
  return collectLeaves(node).find((p) => p.serial === serial) ?? null;
}

export function mapLayout(
  node: LayoutNode,
  pred: (n: LayoutNode) => boolean,
  replacement: LayoutNode | ((n: LayoutNode) => LayoutNode),
): LayoutNode {
  if (pred(node)) {
    return typeof replacement === "function" ? replacement(node) : replacement;
  }
  if (node.type !== "split") return node;
  const a = mapLayout(node.a, pred, replacement);
  const b = mapLayout(node.b, pred, replacement);
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

export function removeLeaf(
  root: LayoutNode,
  paneId: string,
): { root: LayoutNode | null; closed: LeafPane } | null {
  if (root.type === "leaf") {
    if (root.id !== paneId) return null;
    return { root: null, closed: root };
  }
  if (root.a.type === "leaf" && root.a.id === paneId) {
    return { root: root.b, closed: root.a };
  }
  if (root.b.type === "leaf" && root.b.id === paneId) {
    return { root: root.a, closed: root.b };
  }
  const left = removeLeaf(root.a, paneId);
  if (left) {
    if (!left.root) return { root: root.b, closed: left.closed };
    return { root: { ...root, a: left.root }, closed: left.closed };
  }
  const right = removeLeaf(root.b, paneId);
  if (right) {
    if (!right.root) return { root: root.a, closed: right.closed };
    return { root: { ...root, b: right.root }, closed: right.closed };
  }
  return null;
}

export function splitLeaf(
  root: LayoutNode,
  paneId: string,
  dir: "h" | "v",
  newPane: LeafPane,
  nextSplitId: () => string,
): LayoutNode {
  return mapLayout(
    root,
    (n) => n.type === "leaf" && n.id === paneId,
    (leaf) => ({
      type: "split",
      id: nextSplitId(),
      dir,
      ratio: 0.5,
      a: leaf as LeafPane,
      b: newPane,
    }),
  );
}

/** Resolve banner/cwd metadata for scanned keys like wsl:Ubuntu-24.04 */
export function shellMeta(shellKey: string) {
  if (shellKey.startsWith("ssh")) {
    const host = shellKey.startsWith("ssh:") ? shellKey.slice(4) : "远程主机";
    return {
      name: `SSH · ${host}`,
      short: "SSH",
      defaultCwd: "~",
      banner: [`SSH · ${host} · Aether`, "远程主机会话"],
    };
  }
  if (shellKey.startsWith("wsl")) {
    return {
      name: shellKey.startsWith("wsl:") ? `WSL · ${shellKey.slice(4)}` : SHELLS.wsl.name,
      short: "WSL",
      defaultCwd: SHELLS.wsl.defaultCwd,
      banner: [
        shellKey.startsWith("wsl:")
          ? `WSL · ${shellKey.slice(4)} · Aether`
          : SHELLS.wsl.banner[0],
        "本机 WSL 发行版",
      ],
    };
  }
  const base = (["ps", "bash", "zsh", "cmd"] as const).find((k) => k === shellKey);
  if (base) {
    const s = SHELLS[base];
    return {
      name: s.name,
      short: s.short,
      defaultCwd: s.defaultCwd,
      banner: s.banner,
    };
  }
  return {
    name: shellKey,
    short: shellKey.slice(0, 3),
    defaultCwd: guessHomeDir(),
    banner: [`${shellKey} · Aether`],
  };
}

export function makePane(
  shellKey: string,
  nextId: () => string,
  nextSerial: () => number,
  cwd?: string,
  profileId?: string,
): LeafPane {
  const meta = shellMeta(shellKey);
  const useCwd = cwd ?? meta.defaultCwd;
  return {
    type: "leaf",
    id: nextId(),
    serial: nextSerial(),
    shellKey,
    profileId,
    cwd: useCwd,
    history: meta.banner.map((text) => ({ cls: "info" as const, text })),
    cmdHistory: [],
    histIdx: -1,
    draft: "",
  };
}

export function layoutSummary(node: LayoutNode): string {
  if (node.type === "leaf") return `#${node.serial}`;
  const left = layoutSummary(node.a);
  const right = layoutSummary(node.b);
  if (node.dir === "h") return `${left} | ${right}`;
  return `(${left} / ${right})`;
}

export function updateLeaf(
  root: LayoutNode,
  paneId: string,
  updater: (leaf: LeafPane) => LeafPane,
): LayoutNode {
  return mapLayout(
    root,
    (n) => n.type === "leaf" && n.id === paneId,
    (n) => updater(n as LeafPane),
  );
}

export function updateSplitRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  return mapLayout(
    root,
    (n) => n.type === "split" && n.id === splitId,
    (n) => ({ ...(n as SplitNode), ratio }),
  );
}
