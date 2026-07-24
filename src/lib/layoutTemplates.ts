/**
 * Split layout templates — V2.0 major.
 */

import type { LayoutNode, LeafPane } from "./layout";
import type { ShellKey } from "./shells";

export type LayoutTemplate = {
  id: string;
  name: string;
  description: string;
  build: (ctx: {
    nextId: () => string;
    nextSerial: () => number;
    shellKey: ShellKey;
    cwd: string;
  }) => { layout: LayoutNode; activePaneId: string };
};

function leaf(
  ctx: {
    nextId: () => string;
    nextSerial: () => number;
    shellKey: ShellKey;
    cwd: string;
  },
  shellKey?: ShellKey,
): LeafPane {
  return {
    type: "leaf",
    id: ctx.nextId(),
    serial: ctx.nextSerial(),
    shellKey: shellKey || ctx.shellKey,
    cwd: ctx.cwd,
    history: [],
    cmdHistory: [],
    histIdx: -1,
    draft: "",
  };
}

export const BUILTIN_TEMPLATES: LayoutTemplate[] = [
  {
    id: "single",
    name: "单窗格",
    description: "一个终端",
    build: (ctx) => {
      const a = leaf(ctx);
      return { layout: a, activePaneId: a.id };
    },
  },
  {
    id: "edit-build",
    name: "左右双屏",
    description: "主终端 | 辅助终端",
    build: (ctx) => {
      const a = leaf(ctx);
      const b = leaf(ctx);
      return {
        layout: {
          type: "split",
          id: ctx.nextId(),
          dir: "h",
          ratio: 0.55,
          a,
          b,
        },
        activePaneId: a.id,
      };
    },
  },
  {
    id: "edit-build-log",
    name: "编辑+构建+日志",
    description: "左主区，右侧上下两个辅助窗格",
    build: (ctx) => {
      const main = leaf(ctx);
      const build = leaf(ctx);
      const log = leaf(ctx);
      return {
        layout: {
          type: "split",
          id: ctx.nextId(),
          dir: "h",
          ratio: 0.5,
          a: main,
          b: {
            type: "split",
            id: ctx.nextId(),
            dir: "v",
            ratio: 0.5,
            a: build,
            b: log,
          },
        },
        activePaneId: main.id,
      };
    },
  },
  {
    id: "triple-h",
    name: "三列",
    description: "水平三分",
    build: (ctx) => {
      const a = leaf(ctx);
      const b = leaf(ctx);
      const c = leaf(ctx);
      return {
        layout: {
          type: "split",
          id: ctx.nextId(),
          dir: "h",
          ratio: 0.33,
          a,
          b: {
            type: "split",
            id: ctx.nextId(),
            dir: "h",
            ratio: 0.5,
            a: b,
            b: c,
          },
        },
        activePaneId: a.id,
      };
    },
  },
];

export function getTemplate(id: string): LayoutTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
