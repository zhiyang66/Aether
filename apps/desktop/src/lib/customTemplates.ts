/**
 * User-saved layout templates (export current tab layout as template).
 */

import type { LayoutNode } from "./layout";
import { collectLeaves } from "./layout";

export const CUSTOM_TPL_KEY = "sw-custom-templates-v1";

export type CustomTemplate = {
  id: string;
  name: string;
  description?: string;
  /** JSON structure of layout with serials renumbered on apply */
  layout: LayoutNode;
  createdAt: string;
};

export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TPL_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as CustomTemplate[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(list: CustomTemplate[]) {
  localStorage.setItem(CUSTOM_TPL_KEY, JSON.stringify(list.slice(0, 30)));
}

export function addCustomTemplate(name: string, layout: LayoutNode): CustomTemplate {
  const tpl: CustomTemplate = {
    id: `ctpl-${Date.now()}`,
    name: name.trim() || "自定义布局",
    description: `${collectLeaves(layout).length} 窗格`,
    layout: JSON.parse(JSON.stringify(layout)) as LayoutNode,
    createdAt: new Date().toISOString(),
  };
  const list = loadCustomTemplates();
  list.unshift(tpl);
  saveCustomTemplates(list);
  return tpl;
}

export function deleteCustomTemplate(id: string) {
  saveCustomTemplates(loadCustomTemplates().filter((t) => t.id !== id));
}

/** Clone layout with fresh ids/serials. */
export function rehydrateLayout(
  layout: LayoutNode,
  nextId: () => string,
  nextSerial: () => number,
): { layout: LayoutNode; activePaneId: string } {
  let firstLeafId = "";
  function walk(n: LayoutNode): LayoutNode {
    if (n.type === "leaf") {
      const id = nextId();
      if (!firstLeafId) firstLeafId = id;
      return {
        ...n,
        id,
        serial: nextSerial(),
        ptyId: undefined,
        draft: "",
        histIdx: -1,
        // keep shell/cwd/history light
        history: [],
        cmdHistory: [],
      };
    }
    return {
      ...n,
      id: nextId(),
      a: walk(n.a),
      b: walk(n.b),
    };
  }
  const out = walk(layout);
  return { layout: out, activePaneId: firstLeafId };
}
