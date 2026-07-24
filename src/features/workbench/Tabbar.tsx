import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkbenchStore } from "../../store/workbenchStore";
import { useShellCatalogStore } from "../../store/shellCatalogStore";
import { countLeaves } from "../../lib/layout";
import { shellIconClass } from "../../lib/shellProfile";

export function Tabbar() {
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const shellMenuOpen = useWorkbenchStore((s) => s.shellMenuOpen);
  const setShellMenuOpen = useWorkbenchStore((s) => s.setShellMenuOpen);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const closeTab = useWorkbenchStore((s) => s.closeTab);
  const createTabFromProfile = useWorkbenchStore((s) => s.createTabFromProfile);
  const reorderTabs = useWorkbenchStore((s) => s.reorderTabs);
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const profiles = useShellCatalogStore((s) => s.profiles);
  const loading = useShellCatalogStore((s) => s.loading);
  const scan = useShellCatalogStore((s) => s.scan);
  const ensureScanned = useShellCatalogStore((s) => s.ensureScanned);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    void ensureScanned();
  }, [ensureScanned]);

  useLayoutEffect(() => {
    if (!shellMenuOpen || !addBtnRef.current) return;
    const rect = addBtnRef.current.getBoundingClientRect();
    const menuW = 280;
    let left = rect.left;
    // Prefer opening downward; if near bottom, still open down (scrollable)
    let top = rect.bottom + 4;
    if (left + menuW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuW - 8);
    }
    if (left < 8) left = 8;
    // If would go below viewport, shift up a bit but allow overflow above app chrome
    const maxH = Math.min(window.innerHeight * 0.7, 420);
    if (top + 120 > window.innerHeight - 8) {
      top = Math.max(8, rect.top - 4 - Math.min(maxH, 200));
    }
    setMenuPos({ top, left });
  }, [shellMenuOpen, profiles.length]);

  useEffect(() => {
    if (!shellMenuOpen) return;
    void ensureScanned();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addBtnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setShellMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [shellMenuOpen, setShellMenuOpen, ensureScanned]);

  const menu = shellMenuOpen
    ? createPortal(
        <div
          ref={menuRef}
          className="shell-menu open"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <div className="shell-menu-title">
            本机 Shell
            {loading ? " · 扫描中…" : profiles.length ? ` · ${profiles.length}` : ""}
          </div>
          {profiles.length === 0 && !loading && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>
              未检测到 Shell。请点击下方重新扫描。
            </div>
          )}
          {profiles.map((p) => {
            const icon = shellIconClass(p.shellKey);
            return (
              <button
                key={p.id}
                type="button"
                className="shell-option"
                role="menuitem"
                onClick={() => {
                  createTabFromProfile(p);
                  setShellMenuOpen(false);
                }}
              >
                <span className={`so-icon ${icon}`}>{p.short.slice(0, 3)}</span>
                <span className="so-text">
                  <span className="so-name">{p.name}</span>
                  <span className="so-desc">{p.desc || p.path}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="shell-option"
            style={{ marginTop: 4, borderTop: "1px solid var(--border)", borderRadius: 0 }}
            onClick={async () => {
              const list = await scan();
              toastMsg(`已扫描 · ${list.length} 个 Shell`);
            }}
          >
            <span className="so-text">
              <span className="so-name">重新扫描本机</span>
              <span className="so-desc">pwsh / cmd / bash / WSL 发行版…</span>
            </span>
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="tabbar">
      <div className="tabs" id="tabs">
        {tabs.map((tab, tabIndex) => {
          const n = countLeaves(tab.layout);
          const icon = shellIconClass(tab.shellKey);
          return (
            <button
              key={tab.id}
              type="button"
              draggable
              className={`tab${tab.id === activeTabId ? " active" : ""}${dragId === tab.id ? " dragging" : ""}`}
              title={`标签 T${tabIndex + 1}`}
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer.setData("text/tab-id", tab.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = e.dataTransfer.getData("text/tab-id") || dragId;
                if (from) reorderTabs(from, tab.id);
                setDragId(null);
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-close]")) {
                  closeTab(tab.id);
                  return;
                }
                setActiveTab(tab.id);
              }}
            >
              <span className="tab-index">T{tabIndex + 1}</span>
              <span className={`tab-dot ${icon}`} />
              <span className="tab-label">{n > 1 ? `${tab.title} · ${n}` : tab.title}</span>
              <span className="tab-close" data-close title="关闭" aria-label="关闭">
                ×
              </span>
            </button>
          );
        })}
      </div>
      <div className="tab-add-wrap">
        <button
          ref={addBtnRef}
          className="tab-add"
          type="button"
          title="新建终端"
          aria-label="新建终端"
          aria-haspopup="menu"
          aria-expanded={shellMenuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setShellMenuOpen(!shellMenuOpen);
          }}
        >
          <svg viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        {menu}
      </div>
    </div>
  );
}
