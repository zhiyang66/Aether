import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkbenchStore } from "../store/workbenchStore";
import { getLivePtyId, getLiveTerm } from "../features/terminal/termRegistry";
import { isTauri } from "../lib/window";
import { ptyWrite } from "../ipc/pty";

type MenuItem =
  | { type: "item"; id: string; label: string; hint?: string; danger?: boolean; run: () => void }
  | { type: "sep" };

/**
 * App-wide context menu: blocks browser default menu and shows SW actions.
 * Always includes 复制 (selection or xterm selection).
 */
export function AppContextMenu() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [items, setItems] = useState<MenuItem[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const buildItems = useCallback(
    (target: HTMLElement | null): MenuItem[] => {
      const st = useWorkbenchStore.getState();
      const inTerminal = !!target?.closest(".pane-body, .terminal-host, .xterm, .cmd-input");
      const inAi = !!target?.closest(".ai-panel, .ai-messages, .ai-input");
      const selection = window.getSelection()?.toString() ?? "";

      // xterm selection (not always in window.getSelection)
      let xtermSel = "";
      const paneEl = target?.closest("[data-pane-id]") as HTMLElement | null;
      const paneId =
        paneEl?.getAttribute("data-pane-id") ||
        target?.closest(".terminal-host")?.getAttribute("data-pane") ||
        st.activePane()?.id;
      if (paneId) {
        try {
          xtermSel = getLiveTerm(paneId)?.term.getSelection() || "";
        } catch {
          /* ignore */
        }
      }
      const textToCopy = (selection || xtermSel).trim();

      const list: MenuItem[] = [];

      // Always show 复制
      list.push({
        type: "item",
        id: "copy",
        label: textToCopy ? "复制" : "复制（无选中内容）",
        hint: "Ctrl+C",
        run: () => {
          if (!textToCopy) {
            st.toastMsg("没有选中内容");
            return;
          }
          void navigator.clipboard.writeText(textToCopy).then(
            () => st.toastMsg("已复制"),
            () => st.toastMsg("复制失败"),
          );
        },
      });

      list.push({
        type: "item",
        id: "paste",
        label: "粘贴",
        hint: "Ctrl+V",
        run: () => {
          void navigator.clipboard
            .readText()
            .then((t) => {
              if (!t) {
                st.toastMsg("剪贴板为空");
                return;
              }
              const pane = st.activePane();
              if (!pane) {
                st.toastMsg("无焦点窗格");
                return;
              }
              // Prefer live PTY (store.ptyId / useMockTerminal can be stale)
              const livePty = getLivePtyId(pane.id) || pane.ptyId || null;
              if (livePty && isTauri()) {
                void ptyWrite(livePty, t);
                st.toastMsg("已粘贴到终端");
                return;
              }
              st.setDraft(pane.id, (pane.draft || "") + t);
              st.toastMsg("已粘贴到输入");
            })
            .catch(() => st.toastMsg("无法读取剪贴板"));
        },
      });

      list.push({
        type: "item",
        id: "select-all",
        label: "全选",
        run: () => {
          if (paneId) {
            try {
              const live = getLiveTerm(paneId);
              if (live) {
                live.term.selectAll();
                st.toastMsg("已全选终端");
                return;
              }
            } catch {
              /* ignore */
            }
          }
          document.execCommand("selectAll");
        },
      });

      if (inTerminal || !inAi) {
        list.push({ type: "sep" });
        list.push({
          type: "item",
          id: "clear",
          label: "清屏焦点窗格",
          run: () => st.clearPane(paneId || undefined),
        });
        list.push({
          type: "item",
          id: "split-h",
          label: "向右拆分",
          run: () => st.addPane("h"),
        });
        list.push({
          type: "item",
          id: "split-v",
          label: "向下拆分",
          run: () => st.addPane("v"),
        });
        list.push({
          type: "item",
          id: "new-tab",
          label: "新建标签…",
          run: () => st.setShellMenuOpen(true),
        });
      }

      list.push({ type: "sep" });
      list.push({
        type: "item",
        id: "ai",
        label: st.aiOpen ? "隐藏 Agent" : "显示 Agent",
        run: () => st.setAiOpen(!st.aiOpen),
      });
      list.push({
        type: "item",
        id: "settings",
        label: "打开设置",
        run: () => nav("/settings"),
      });
      list.push({
        type: "item",
        id: "palette",
        label: "命令面板",
        hint: "Ctrl+Shift+P",
        run: () => window.dispatchEvent(new CustomEvent("sw:open-palette")),
      });

      return list;
    },
    [nav],
  );

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (e.shiftKey) return; // escape hatch: Shift+right-click → browser menu
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement | null;
      const next = buildItems(target);
      setItems(next);
      const pad = 8;
      const mw = 220;
      const mh = Math.min(400, 48 + next.length * 34);
      let x = e.clientX;
      let y = e.clientY;
      if (x + mw > window.innerWidth - pad) x = window.innerWidth - mw - pad;
      if (y + mh > window.innerHeight - pad) y = window.innerHeight - mh - pad;
      setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
      setOpen(true);
    };
    // Capture-phase close must ignore clicks *inside* the menu, otherwise the
    // menu unmounts before the item button's onClick can run (everything looks dead).
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (menuRef.current && t && menuRef.current.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClose = () => setOpen(false);
    document.addEventListener("contextmenu", onCtx, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("contextmenu", onCtx, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [buildItems]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="app-ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.type === "sep" ? (
          <div key={`sep-${i}`} className="app-ctx-sep" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className={`app-ctx-item${it.danger ? " danger" : ""}`}
            onClick={() => {
              setOpen(false);
              // Defer so unmount doesn't interrupt the action mid-handler
              queueMicrotask(() => {
                try {
                  it.run();
                } catch {
                  /* ignore */
                }
              });
            }}
          >
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
