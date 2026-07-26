import { create } from "zustand";
import {
  type LayoutNode,
  type LeafPane,
  type Tab,
  MAX_PANES,
  collectLeaves,
  countLeaves,
  findLeaf,
  findLeafBySerial,
  makePane,
  removeLeaf,
  shellMeta,
  splitLeaf,
  updateLeaf,
  updateSplitRatio,
} from "../lib/layout";
import { defaultShellForPlatform, promptText } from "../lib/shells";
import { nextId } from "../lib/ids";
import { mockRunCommand, resolveMockCwd } from "../lib/mockShell";
import type { ScannedShellProfile } from "../lib/shellProfile";
import { useShellCatalogStore } from "./shellCatalogStore";
import {
  loadAgentSessions,
  loadTerminalSession,
  saveAgentSessions,
  saveTerminalSession,
} from "./persist";
import { resolveDangerAction } from "../lib/danger";
import { appendPaneOutput, clearPaneOutput, setPaneOutputBanner } from "../lib/paneRegistry";
import { captureSnapshots } from "../lib/outputSnapshot";
import { ptyWrite } from "../ipc/pty";
import { recordCommand } from "../lib/commandHistory";
import {
  getLivePtyId,
  getLiveTerm,
  listLiveTerms,
} from "../features/terminal/termRegistry";
import { useSettingsStore, type SettingsState } from "./settingsStore";

type ToastState = { message: string; visible: boolean };

export type AiMessageAction = {
  type: "insert" | "run" | "insert_and_run" | "focus" | "reply";
  targetSerial?: number;
  command?: string;
  /** For type=reply: text to send as next user message */
  text?: string;
  label?: string;
};

export type AiToolTraceStep = {
  name: string;
  argsPreview?: string;
  ok: boolean;
  summary: string;
};

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  html?: string;
  /** Collapsible chain-of-thought (hidden by default in UI) */
  thinking?: string;
  /** Model-emitted action chips only — empty means no buttons */
  actions?: AiMessageAction[];
  /** User already clicked an action chip on this message */
  actionsConsumed?: boolean;
  /** Tool loop timeline for this reply */
  toolTrace?: AiToolTraceStep[];
  /** @deprecated use actions[0] */
  cmd?: string;
  targetSerial?: number;
  createdAt: string;
};

export type AgentChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId?: string;
  effortId?: string;
  messages: AiMessage[];
};

type WorkbenchState = {
  tabs: Tab[];
  activeTabId: string | null;
  activePaneId: string | null;
  nextSerial: number;
  aiOpen: boolean;
  aiWidth: number;
  aiModel: string;
  aiEffort: "low" | "medium" | "high" | "max";
  aiModels: { id: string; label: string }[];
  aiModelsStatus: string;
  toast: ToastState;
  shellMenuOpen: boolean;
  windowMaximized: boolean;
  useMockTerminal: boolean;

  // agent sessions
  agentSessions: AgentChatSession[];
  activeAgentSessionId: string | null;
  agentBusy: boolean;

  // actions
  bootstrap: () => void;
  toastMsg: (msg: string) => void;
  setShellMenuOpen: (open: boolean) => void;
  setAiOpen: (open: boolean) => void;
  setAiWidth: (w: number) => void;
  setAiModel: (id: string) => void;
  setAiEffort: (e: WorkbenchState["aiEffort"]) => void;
  setAiModels: (models: { id: string; label: string }[], status: string) => void;
  setWindowMaximized: (v: boolean) => void;

  activeTab: () => Tab | null;
  activePane: () => LeafPane | null;
  resolveSerial: (serial: number) => LeafPane | null;

  createTab: (shellKey: string, profileId?: string) => void;
  createTabFromProfile: (profile: ScannedShellProfile) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setActivePane: (paneId: string) => void;
  addPane: (dir: "h" | "v") => void;
  closePane: (paneId: string) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  setDraft: (paneId: string, draft: string) => void;
  historyNavigate: (paneId: string, dir: "up" | "down") => void;
  runCommand: (paneId: string, raw: string) => void;
  clearPane: (paneId?: string) => void;
  insertToPane: (serial: number | undefined, cmd: string, run: boolean) => void;
  setPaneCwd: (paneId: string, cwd: string) => void;
  notePaneCommand: (paneId: string, cmd: string) => void;
  requestAppClose: () => void;
  reorderTabs: (fromId: string, toId: string) => void;
  exportWorkbench: () => void;
  importWorkbench: (raw: string) => void;
  toggleFocusMaximize: () => void;
  focusMaximized: boolean;
  layoutBackup: LayoutNode | null;
  applyLayoutTemplate: (templateId: string) => void;
  saveCurrentAsTemplate: (name: string) => void;
  applyCustomTemplate: (id: string) => void;
  saveWorkspace: (name: string) => void;
  switchWorkspace: (id: string) => void;
  listWorkspaces: () => { id: string; name: string }[];

  // agent chat
  newAgentSession: () => void;
  switchAgentSession: (id: string) => void;
  deleteAgentSession: (id: string) => void;
  appendAgentMessage: (
    msg: Omit<AiMessage, "id" | "createdAt"> & { id?: string },
    /** Pin to a session (stream replies must not follow UI switch) */
    sessionId?: string | null,
  ) => void;
  clearActiveAgentMessages: () => void;
  /** Hide action chips on a message after user clicks one */
  markActionsConsumed: (messageId: string) => void;
  setAgentBusy: (v: boolean) => void;
  /** Active stream id for Stop cancel (null when idle). */
  agentStreamId: string | null;
  setAgentStreamId: (id: string | null) => void;
  getActiveAgentSession: () => AgentChatSession | null;
};

/** Pane serial is per-tab: new tab starts at #1 again. */
function maxSerialInLayout(layout: LayoutNode): number {
  const leaves = collectLeaves(layout);
  if (!leaves.length) return 0;
  return Math.max(...leaves.map((l) => l.serial));
}

/** Clear runtime PTY handles before restoring saved session. */
function stripRuntime(node: LayoutNode): LayoutNode {
  if (node.type === "leaf") {
    return { ...node, ptyId: undefined };
  }
  return {
    ...node,
    a: stripRuntime(node.a),
    b: stripRuntime(node.b),
  };
}

/** Strip runtime PTY handles from every tab (persist/export/import boundaries). */
function stripTabsRuntime(tabs: Tab[]): Tab[] {
  return tabs.map((t) => ({ ...t, layout: stripRuntime(t.layout) }));
}

/**
 * Release PTY + xterm sessions for every leaf in the given layouts.
 * Must be called whenever a layout is discarded wholesale (close tab,
 * apply template, switch workspace, import) — otherwise shell processes
 * leak and stale sessions can become Agent write targets.
 */
function disposeLayoutSessions(layouts: Array<LayoutNode | null | undefined>) {
  const paneIds = new Set<string>();
  for (const layout of layouts) {
    if (!layout) continue;
    for (const leaf of collectLeaves(layout)) paneIds.add(leaf.id);
  }
  if (!paneIds.size) return;
  void import("../features/terminal/XtermHost").then(({ disposePaneSession }) => {
    for (const id of paneIds) void disposePaneSession(id);
  });
}

function genPane(
  shellKey: string,
  serial: number,
  profileId?: string,
  cwd?: string,
): LeafPane {
  return makePane(shellKey, () => nextId("pane"), () => serial, cwd, profileId);
}

function mockShellKey(shellKey: string): "ps" | "bash" | "zsh" | "cmd" | "wsl" {
  if (shellKey.startsWith("wsl")) return "wsl";
  if (shellKey === "cmd") return "cmd";
  if (shellKey === "zsh") return "zsh";
  if (shellKey === "bash") return "bash";
  return "ps";
}

/** Empty chat — no seed assistant message. */
function emptyAgentSession(modelId?: string, effortId?: string): AgentChatSession {
  const now = new Date().toISOString();
  return {
    id: nextId("achat"),
    title: "新会话",
    createdAt: now,
    updatedAt: now,
    modelId,
    effortId,
    messages: [],
  };
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => {
  return {
    tabs: [],
    activeTabId: null,
    activePaneId: null,
    nextSerial: 1,
    aiOpen: true,
    aiWidth: 360,
    aiModel: "",
    aiEffort: "medium",
    aiModels: [],
    aiModelsStatus: "未加载",
    toast: { message: "", visible: false },
    shellMenuOpen: false,
    windowMaximized: true,
    // Browser/dev without Tauri uses mock; Tauri desktop uses real PTY (xterm).
    useMockTerminal: typeof window === "undefined" || !("__TAURI_INTERNALS__" in window),
    agentSessions: [],
    activeAgentSessionId: null,
    agentBusy: false,
    agentStreamId: null,
    focusMaximized: false,
    layoutBackup: null,

    bootstrap: () => {
      // Re-detect Tauri: store module may load before __TAURI_INTERNALS__ is injected
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        set({ useMockTerminal: false });
      }

      const restore = useSettingsStore.getState().restoreSession;
      const saved = restore ? loadTerminalSession() : null;
      const settings = useSettingsStore.getState();
      const preferredModel =
        settings.aiDefaultModelId || saved?.aiModel || get().aiModel || "";

      // Cap restored tabs to avoid thrashing on multi-tab PTY startup
      const MAX_RESTORE_TABS = 6;
      if (saved?.tabs?.length) {
        let tabs = saved.tabs.slice(0, MAX_RESTORE_TABS).map((t) => ({
          ...t,
          // ensure no stale pty ids
          layout: stripRuntime(t.layout),
        }));
        let activeTabId = saved.activeTabId;
        if (!tabs.find((t) => t.id === activeTabId)) {
          activeTabId = tabs[0]?.id ?? null;
        }
        const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
        let activePaneId = saved.activePaneId;
        if (activeTab && !findLeaf(activeTab.layout, activePaneId || "")) {
          activePaneId = collectLeaves(activeTab.layout)[0]?.id ?? null;
        }
        set({
          tabs,
          activeTabId,
          activePaneId,
          nextSerial: Math.max(saved.nextSerial || 1, 1),
          aiOpen: saved.aiOpen ?? true,
          aiWidth: saved.aiWidth ?? 360,
          // Prefer settings default model; fall back to last session model
          aiModel: preferredModel || saved.aiModel || "",
          aiEffort: (saved.aiEffort as WorkbenchState["aiEffort"]) || "medium",
        });
      } else {
        const cat = useShellCatalogStore.getState();
        const prof = cat.defaultProfile();
        const shellKey = prof?.shellKey || defaultShellForPlatform();
        const pane = genPane(
          shellKey,
          1,
          prof?.id,
          useSettingsStore.getState().cwd || undefined,
        );
        const tab: Tab = {
          id: nextId("tab"),
          title: prof?.name || shellMeta(shellKey).name,
          shellKey,
          profileId: prof?.id,
          layout: pane,
          activePaneId: pane.id,
        };
        set({
          tabs: [tab],
          activeTabId: tab.id,
          activePaneId: pane.id,
        });
        // startupCmd must also run for the bootstrap-created first tab (mock path;
        // real PTY runs it in XtermHost after session start)
        const startup = settings.startupCmd?.trim();
        if (startup && get().useMockTerminal) {
          window.setTimeout(() => {
            get().runCommand(pane.id, startup);
          }, 0);
        }
      }

      // Agent sessions: restoreAgentSession=true resumes the last active
      // session; otherwise start with a fresh empty one (history stays listed)
      const modelForSession =
        get().aiModel || useSettingsStore.getState().aiDefaultModelId;
      const prev = loadAgentSessions();
      const kept = (prev?.sessions || [])
        .filter((s) => s.messages.some((m) => m.role === "user"))
        .slice(0, 40);
      const wantRestore = useSettingsStore.getState().restoreAgentSession;
      const restored = wantRestore
        ? kept.find((s) => s.id === prev?.activeId) || kept[0]
        : undefined;
      if (restored) {
        set({
          agentSessions: kept,
          activeAgentSessionId: restored.id,
          agentBusy: false,
          agentStreamId: null,
        });
      } else {
        const fresh = emptyAgentSession(modelForSession, get().aiEffort);
        set({
          agentSessions: [fresh, ...kept],
          activeAgentSessionId: fresh.id,
          agentBusy: false,
          agentStreamId: null,
        });
      }

      // Sync maximized flag with the actual OS window state (was hardcoded true)
      void (async () => {
        const { winIsMaximized } = await import("../lib/window");
        try {
          set({ windowMaximized: await winIsMaximized() });
        } catch {
          /* keep default */
        }
      })();

      // Re-fetch model list on launch when endpoint is configured
      void refreshModelsOnBootstrap();

      // debounce persist (once per app lifetime)
      if (typeof window !== "undefined" && !(window as unknown as { __swPersist?: boolean }).__swPersist) {
        (window as unknown as { __swPersist?: boolean }).__swPersist = true;
        let t: number | undefined;
        useWorkbenchStore.subscribe((s) => {
          window.clearTimeout(t);
          t = window.setTimeout(() => {
            try {
              saveTerminalSession({
                tabs: s.tabs,
                activeTabId: s.activeTabId,
                activePaneId: s.activePaneId,
                nextSerial: s.nextSerial,
                aiOpen: s.aiOpen,
                aiWidth: s.aiWidth,
                aiModel: s.aiModel,
                aiEffort: s.aiEffort,
              });
              // Don't persist empty-only active; keep user chats
              const toSave = s.agentSessions.filter(
                (sess) =>
                  sess.id !== s.activeAgentSessionId ||
                  sess.messages.some((m) => m.role === "user"),
              );
              saveAgentSessions(toSave, s.activeAgentSessionId);
              const settings = useSettingsStore.getState();
              if (settings.outputSnapshotEnabled) {
                const ids = s.tabs.flatMap((tab) =>
                  collectLeaves(tab.layout).map((l) => l.id),
                );
                captureSnapshots(ids, settings.outputSnapshotLines);
              }
            } catch {
              /* ignore persist errors */
            }
          }, 500);
        });
      }
    },

    toastMsg: (message) => {
      set({ toast: { message, visible: true } });
      window.setTimeout(() => {
        set((s) =>
          s.toast.message === message ? { toast: { message, visible: false } } : s,
        );
      }, 1800);
    },

    setShellMenuOpen: (shellMenuOpen) => set({ shellMenuOpen }),
    setAiOpen: (aiOpen) => set({ aiOpen }),
    setAiWidth: (aiWidth) => set({ aiWidth: Math.min(520, Math.max(280, aiWidth)) }),
    setAiModel: (aiModel) => {
      set({ aiModel });
      // Persist as default when user picks a model
      if (aiModel) {
        const st = useSettingsStore.getState();
        if (st.aiDefaultModelId !== aiModel) {
          st.patch({ aiDefaultModelId: aiModel });
        }
      }
    },
    setAiEffort: (aiEffort) => set({ aiEffort }),
    setAiModels: (aiModels, aiModelsStatus) => set({ aiModels, aiModelsStatus }),
    setWindowMaximized: (windowMaximized) => set({ windowMaximized }),

    activeTab: () => {
      const s = get();
      return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0] ?? null;
    },

    activePane: () => {
      const tab = get().activeTab();
      if (!tab) return null;
      const id = tab.activePaneId || get().activePaneId;
      if (!id) return collectLeaves(tab.layout)[0] ?? null;
      return findLeaf(tab.layout, id) || collectLeaves(tab.layout)[0] || null;
    },

    resolveSerial: (serial) => {
      const s = get();
      // Prefer active tab — serials restart at #1 per tab, so first-match is wrong
      const active = s.tabs.find((t) => t.id === s.activeTabId);
      if (active) {
        const leaf = findLeafBySerial(active.layout, serial);
        if (leaf) return leaf;
      }
      for (const tab of s.tabs) {
        if (tab.id === s.activeTabId) continue;
        const leaf = findLeafBySerial(tab.layout, serial);
        if (leaf) return leaf;
      }
      return null;
    },

    createTab: (shellKey, profileId) => {
      const settings = useSettingsStore.getState();
      const cat = useShellCatalogStore.getState();
      const prof =
        (profileId ? cat.getById(profileId) : undefined) ||
        cat.getByShellKey(shellKey);
      // New tab always restarts pane numbers at #1
      const pane = genPane(
        prof?.shellKey || shellKey,
        1,
        prof?.id || profileId,
        settings.cwd?.trim() || undefined,
      );
      const title = prof?.name || shellMeta(pane.shellKey).name;
      const tab: Tab = {
        id: nextId("tab"),
        title,
        shellKey: pane.shellKey,
        profileId: pane.profileId,
        layout: pane,
        activePaneId: pane.id,
      };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        activePaneId: pane.id,
        shellMenuOpen: false,
      }));
      if (settings.startupCmd?.trim() && get().useMockTerminal) {
        window.setTimeout(() => {
          get().runCommand(pane.id, settings.startupCmd.trim());
        }, 0);
      }
      get().toastMsg(`已新建 ${title}`);
    },

    createTabFromProfile: (profile) => {
      get().createTab(profile.shellKey, profile.id);
    },

    closeTab: (tabId) => {
      const s = get();
      const settings = useSettingsStore.getState();
      const closing = s.tabs.find((t) => t.id === tabId);
      // Maximized focus keeps the full layout in backup — those panes must die too
      const closingBackup =
        tabId === s.activeTabId && s.focusMaximized ? s.layoutBackup : null;
      if (s.tabs.length <= 1) {
        if (settings.lastTabAction === "close") {
          get().requestAppClose();
          return;
        }
        disposeLayoutSessions([closing?.layout, closingBackup]);
        // 新建会话：优先扫描结果默认 profile
        const prof = useShellCatalogStore.getState().defaultProfile();
        const shellKey = prof?.shellKey || settings.defaultShell || defaultShellForPlatform();
        const pane = genPane(shellKey, 1, prof?.id, settings.cwd || undefined);
        const tab: Tab = {
          id: nextId("tab"),
          title: prof?.name || shellMeta(shellKey).name,
          shellKey,
          profileId: prof?.id,
          layout: pane,
          activePaneId: pane.id,
        };
        set({
          tabs: [tab],
          activeTabId: tab.id,
          activePaneId: pane.id,
          focusMaximized: false,
          layoutBackup: null,
        });
        const startup = settings.startupCmd?.trim();
        if (startup && get().useMockTerminal) {
          window.setTimeout(() => {
            get().runCommand(pane.id, startup);
          }, 0);
        }
        get().toastMsg("已新建默认会话");
        return;
      }
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return;
      disposeLayoutSessions([closing?.layout, closingBackup]);
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      let activeTabId = s.activeTabId;
      let activePaneId = s.activePaneId;
      if (activeTabId === tabId) {
        const next = tabs[Math.max(0, idx - 1)];
        activeTabId = next.id;
        activePaneId = next.activePaneId;
      }
      set({
        tabs,
        activeTabId,
        activePaneId,
        ...(closingBackup ? { focusMaximized: false, layoutBackup: null } : {}),
      });
    },

    setActiveTab: (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      set({
        activeTabId: tabId,
        activePaneId: tab.activePaneId || collectLeaves(tab.layout)[0]?.id || null,
      });
    },

    setActivePane: (paneId) => {
      const tab = get().activeTab();
      if (!tab) return;
      const tabs = get().tabs.map((t) =>
        t.id === tab.id ? { ...t, activePaneId: paneId } : t,
      );
      set({ tabs, activePaneId: paneId });
    },

    addPane: (dir) => {
      const tab = get().activeTab();
      if (!tab) return;
      if (countLeaves(tab.layout) >= MAX_PANES) {
        get().toastMsg(`最多 ${MAX_PANES} 个分屏窗格`);
        return;
      }
      const focus = get().activePane();
      if (!focus) return;
      // Within a tab, serials grow: max existing + 1
      const nextSer = maxSerialInLayout(tab.layout) + 1;
      const pane = genPane(
        tab.shellKey,
        nextSer,
        tab.profileId || focus.profileId,
      );
      const layout = splitLeaf(tab.layout, focus.id, dir, pane, () => nextId("split"));
      const tabs = get().tabs.map((t) =>
        t.id === tab.id ? { ...t, layout, activePaneId: pane.id } : t,
      );
      set({ tabs, activePaneId: pane.id });
      get().toastMsg(
        `在 #${focus.serial} 内拆分 → #${pane.serial}（${dir === "h" ? "左右" : "上下"} 50%）`,
      );
    },

    closePane: (paneId) => {
      const tab = get().activeTab();
      if (!tab) return;
      if (countLeaves(tab.layout) <= 1) {
        get().toastMsg("至少保留一个窗格 · 关闭标签请点标签上的 ×");
        return;
      }
      const result = removeLeaf(tab.layout, paneId);
      if (!result || !result.root) return;
      // Kill PTY only for the closed leaf (siblings must stay alive)
      void import("../features/terminal/XtermHost").then(({ disposePaneSession }) => {
        void disposePaneSession(paneId);
      });
      const leaves = collectLeaves(result.root);
      const next = leaves[leaves.length - 1] || leaves[0];
      const tabs = get().tabs.map((t) =>
        t.id === tab.id
          ? { ...t, layout: result.root as LayoutNode, activePaneId: next.id }
          : t,
      );
      set({ tabs, activePaneId: next.id });
      get().toastMsg(`已关闭窗格 #${result.closed.serial}`);
    },

    setSplitRatio: (splitId, ratio) => {
      const tab = get().activeTab();
      if (!tab) return;
      const layout = updateSplitRatio(tab.layout, splitId, ratio);
      const tabs = get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t));
      set({ tabs });
    },

    setDraft: (paneId, draft) => {
      const tab = get().activeTab();
      if (!tab) return;
      const layout = updateLeaf(tab.layout, paneId, (leaf) => ({ ...leaf, draft }));
      const tabs = get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t));
      set({ tabs });
    },

    historyNavigate: (paneId, dir) => {
      const tab = get().activeTab();
      if (!tab) return;
      const pane = findLeaf(tab.layout, paneId);
      if (!pane || !pane.cmdHistory.length) return;
      let histIdx = pane.histIdx;
      if (dir === "up") {
        histIdx = histIdx < 0 ? pane.cmdHistory.length - 1 : Math.max(0, histIdx - 1);
      } else {
        if (histIdx < 0) return;
        histIdx = Math.min(pane.cmdHistory.length, histIdx + 1);
        if (histIdx >= pane.cmdHistory.length) {
          const layout = updateLeaf(tab.layout, paneId, (leaf) => ({
            ...leaf,
            histIdx: -1,
            draft: "",
          }));
          set({ tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t)) });
          return;
        }
      }
      const draft = pane.cmdHistory[histIdx] || "";
      const layout = updateLeaf(tab.layout, paneId, (leaf) => ({
        ...leaf,
        histIdx,
        draft,
      }));
      set({ tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t)) });
    },

    runCommand: (paneId, raw) => {
      const tab = get().activeTab();
      if (!tab) return;
      const pane = findLeaf(tab.layout, paneId);
      if (!pane) return;
      const cmd = raw.replace(/\n$/, "");
      const prompt = promptText(pane.shellKey, pane.cwd) + cmd;
      const lines = [{ cls: "out" as const, text: prompt }];
      let history = [...pane.history, ...lines];
      const cmdHistory = cmd.trim() ? [...pane.cmdHistory, cmd] : pane.cmdHistory;

      if (get().useMockTerminal) {
        // Mock `cd`: update pane.cwd so the header/statusbar stay honest
        const cdMatch = cmd.trim().match(/^cd(?:\s+(.*))?$/i);
        if (cdMatch !== null) {
          const newCwd = resolveMockCwd(pane.cwd, cdMatch[1] || "", pane.shellKey);
          appendPaneOutput(paneId, prompt + "\n");
          const layout = updateLeaf(tab.layout, paneId, (leaf) => ({
            ...leaf,
            cwd: newCwd,
            history,
            cmdHistory,
            histIdx: -1,
            draft: "",
          }));
          set({ tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t)) });
          return;
        }
        const mk = mockShellKey(pane.shellKey);
        const meta = shellMeta(pane.shellKey);
        const results = mockRunCommand(mk, cmd);
        if (results.some((r) => r.clear)) {
          history = meta.banner.map((text) => ({ cls: "info", text }));
        } else {
          history = [...history, ...results];
        }
        if (results.some((r) => r.clear)) {
          setPaneOutputBanner(paneId, meta.banner);
        } else {
          appendPaneOutput(
            paneId,
            [prompt, ...results.map((r) => r.text)].join("\n") + "\n",
          );
        }
      }

      const layout = updateLeaf(tab.layout, paneId, (leaf) => ({
        ...leaf,
        history,
        cmdHistory,
        histIdx: -1,
        draft: "",
      }));
      const tabs = get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t));
      set({ tabs });
    },

    clearPane: (paneId) => {
      const tab = get().activeTab();
      if (!tab) return;
      const pane = paneId
        ? findLeaf(tab.layout, paneId)
        : get().activePane();
      if (!pane) return;

      // Real xterm / PTY: clear viewport + send shell clear when possible
      const live = getLiveTerm(pane.id);
      if (live && !live.disposed) {
        try {
          live.term.clear();
        } catch {
          /* ignore */
        }
        const livePty = live.ptyId || getLivePtyId(pane.id);
        if (livePty) {
          const isWin =
            pane.shellKey === "ps" ||
            pane.shellKey === "cmd" ||
            pane.shellKey.startsWith("ps");
          void ptyWrite(livePty, isWin ? "Clear-Host\r" : "clear\r");
        }
        clearPaneOutput(pane.id);
        window.dispatchEvent(
          new CustomEvent("sw:clear-pane", { detail: { paneId: pane.id } }),
        );
      }

      // Mock terminal history (also resets banner text for mock path)
      const history = shellMeta(pane.shellKey).banner.map((text) => ({
        cls: "info" as const,
        text,
      }));
      const layout = updateLeaf(tab.layout, pane.id, (leaf) => ({ ...leaf, history }));
      const tabs = get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t));
      set({ tabs });
      get().toastMsg("已清屏焦点窗格");
    },

    insertToPane: (serial, cmd, run) => {
      const settings = useSettingsStore.getState();
      const s = get();

      // Resolve target: honor #N when provided; otherwise focus pane
      let pane =
        serial != null && Number.isFinite(serial)
          ? s.resolveSerial(serial)
          : s.activePane();

      if (serial != null && !pane) {
        get().toastMsg(`窗格 #${serial} 不存在 · 已取消`);
        return;
      }
      if (!pane) {
        get().toastMsg("没有选中的窗格");
        return;
      }

      // Optionally restrict Agent to current tab only
      if (settings.agentCurrentTabOnly && serial != null) {
        const tab = s.activeTab();
        if (tab && !findLeaf(tab.layout, pane.id)) {
          get().toastMsg(
            `窗格 #${serial} 不在当前标签 · 关闭「仅当前标签」或先切换标签`,
          );
          return;
        }
      }

      // Focus the target pane so UI matches write destination
      for (const t of s.tabs) {
        if (findLeaf(t.layout, pane.id)) {
          if (t.id !== s.activeTabId) s.setActiveTab(t.id);
          break;
        }
      }
      if (s.activePaneId !== pane.id) s.setActivePane(pane.id);
      // re-read after focus (same reference usually)
      pane = get().resolveSerial(pane.serial) || get().activePane() || pane;

      // Exec mode + danger policy — shared with tool loop via resolveDangerAction
      let shouldRun = run;
      if (run) {
        const decision = resolveDangerAction(cmd, settings, true);
        shouldRun = decision.run;
        if (decision.note === "danger-insert") {
          get().toastMsg("⚠ 危险命令 · 已改为仅插入，请在终端确认后手动回车");
        } else if (decision.note === "danger-auto-run") {
          get().toastMsg("⚠ 危险命令 · 已按自动模式执行");
        }
      }

      // Live PTY: termRegistry is source of truth (leaf.ptyId often empty after restore)
      let targetPaneId = pane.id;
      let livePty = getLivePtyId(pane.id) || pane.ptyId || null;

      // Fallback: any live session on a leaf with the same serial in the active tab,
      // or the only live PTY if there is exactly one.
      if (!livePty && !get().useMockTerminal) {
        const lives = listLiveTerms();
        if (lives.length === 1) {
          livePty = lives[0].ptyId;
          targetPaneId = lives[0].paneId;
        } else if (lives.length > 1) {
          // Match serial among live panes
          for (const L of lives) {
            for (const tab of get().tabs) {
              const leaf = findLeaf(tab.layout, L.paneId);
              if (leaf && leaf.serial === pane.serial) {
                livePty = L.ptyId;
                targetPaneId = L.paneId;
                break;
              }
            }
            if (livePty) break;
          }
          // Last resort: active pane's live term
          if (!livePty) {
            const ap = get().activePane();
            if (ap) {
              const id = getLivePtyId(ap.id);
              if (id) {
                livePty = id;
                targetPaneId = ap.id;
              }
            }
          }
        }
      }

      if (!get().useMockTerminal && livePty) {
        const payload = shouldRun ? `${cmd}\r` : cmd;
        void ptyWrite(livePty, payload).catch((e) => {
          get().toastMsg(
            `写入终端失败: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
        if (pane.ptyId !== livePty || targetPaneId !== pane.id) {
          const tabs = get().tabs.map((tab) => {
            const layout = updateLeaf(tab.layout, targetPaneId, (leaf) =>
              leaf.ptyId === livePty ? leaf : { ...leaf, ptyId: livePty! },
            );
            return layout === tab.layout ? tab : { ...tab, layout };
          });
          set({ tabs });
        }
        if (shouldRun) {
          recordCommand(cmd, pane.shellKey, settings.historyLimit);
          get().notePaneCommand(targetPaneId, cmd);
        }
        get().toastMsg(
          shouldRun
            ? `已在窗格 #${pane.serial} 运行`
            : `已插入到窗格 #${pane.serial}`,
        );
        return;
      }

      // No live PTY: real desktop should not silently pretend success
      if (!get().useMockTerminal) {
        const n = listLiveTerms().length;
        get().toastMsg(
          n === 0
            ? `终端尚未就绪（无 PTY 会话）· 请新开标签或点一下终端区域`
            : `窗格 #${pane.serial} 未挂载 PTY（当前有 ${n} 个活动终端）· 请点一下该窗格`,
        );
        return;
      }

      if (shouldRun) {
        get().runCommand(pane.id, cmd);
        get().toastMsg(`已在窗格 #${pane.serial} 运行`);
      } else {
        const tab = get().activeTab();
        if (!tab) return;
        const layout = updateLeaf(tab.layout, pane.id, (leaf) => ({
          ...leaf,
          draft: cmd,
        }));
        const tabs = get().tabs.map((t) => (t.id === tab.id ? { ...t, layout } : t));
        set({ tabs });
        get().toastMsg(`已插入到窗格 #${pane.serial}`);
      }
    },

    setPaneCwd: (paneId, cwd) => {
      set((s) => ({
        tabs: s.tabs.map((tab) => {
          const layout = updateLeaf(tab.layout, paneId, (leaf) =>
            leaf.cwd === cwd ? leaf : { ...leaf, cwd },
          );
          return layout === tab.layout ? tab : { ...tab, layout };
        }),
      }));
    },

    notePaneCommand: (paneId, cmd) => {
      const t = cmd.trim();
      if (!t) return;
      set((s) => ({
        tabs: s.tabs.map((tab) => {
          const layout = updateLeaf(tab.layout, paneId, (leaf) => ({
            ...leaf,
            cmdHistory: [...leaf.cmdHistory, t].slice(-200),
            histIdx: -1,
          }));
          return layout === tab.layout ? tab : { ...tab, layout };
        }),
      }));
    },

    requestAppClose: () => {
      const s = get();
      const settings = useSettingsStore.getState();
      void (async () => {
        // In-app dialog (askConfirm) is non-blocking — safe in the WebView
        if (settings.confirmMultiTabClose && s.tabs.length > 1) {
          const { askConfirm } = await import("../components/AppDialog");
          const ok = await askConfirm("关闭窗口", {
            message: `当前有 ${s.tabs.length} 个标签，全部会话将结束。确定关闭？`,
            danger: true,
            okLabel: "关闭",
          });
          if (!ok) return;
        }
        const { winClose } = await import("../lib/window");
        await winClose();
      })();
    },

    reorderTabs: (fromId, toId) => {
      set((s) => {
        const tabs = s.tabs;
        const from = tabs.findIndex((t) => t.id === fromId);
        const to = tabs.findIndex((t) => t.id === toId);
        if (from < 0 || to < 0 || from === to) return s;
        const next = [...tabs];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return { tabs: next };
      });
    },

    exportWorkbench: () => {
      void import("../lib/exportImport").then(({ buildExport, downloadJson }) => {
        const s = get();
        const exp = buildExport({
          tabs: s.tabs,
          activeTabId: s.activeTabId,
          activePaneId: s.activePaneId,
          nextSerial: s.nextSerial,
          aiOpen: s.aiOpen,
          aiWidth: s.aiWidth,
          aiModel: s.aiModel,
          aiEffort: s.aiEffort,
          agentSessions: s.agentSessions,
          activeAgentSessionId: s.activeAgentSessionId,
          settingsJson: localStorage.getItem("sw-settings-v1"),
        });
        downloadJson(`shell-workbench-export-${Date.now()}.json`, exp);
        get().toastMsg("已导出工作台（不含 API Key）");
      });
    },

    importWorkbench: (raw) => {
      void import("../lib/exportImport").then(({ parseExport }) => {
        try {
          const data = parseExport(raw);
          if (data.terminal?.tabs?.length) {
            const cur = get();
            disposeLayoutSessions([
              ...cur.tabs.map((t) => t.layout),
              cur.focusMaximized ? cur.layoutBackup : null,
            ]);
            set({
              tabs: stripTabsRuntime(data.terminal.tabs),
              activeTabId: data.terminal.activeTabId,
              activePaneId: data.terminal.activePaneId,
              nextSerial: data.terminal.nextSerial || get().nextSerial,
              aiOpen: data.terminal.aiOpen ?? true,
              aiWidth: data.terminal.aiWidth ?? 360,
              aiModel: data.terminal.aiModel || "",
              aiEffort: (data.terminal.aiEffort as WorkbenchState["aiEffort"]) || "medium",
              focusMaximized: false,
              layoutBackup: null,
            });
          }
          if (data.agent?.sessions) {
            set({
              agentSessions: data.agent.sessions,
              activeAgentSessionId: data.agent.activeId,
            });
          }
          if (data.settings) {
            const rest = { ...data.settings } as Record<string, unknown>;
            delete rest.aiApiKey;
            useSettingsStore.getState().patch(rest as Partial<SettingsState>);
          }
          get().toastMsg("已导入工作台");
        } catch (e) {
          get().toastMsg(`导入失败：${e instanceof Error ? e.message : e}`);
        }
      });
    },

    toggleFocusMaximize: () => {
      const s = get();
      const tab = s.activeTab();
      const pane = s.activePane();
      if (!tab || !pane) return;
      if (s.focusMaximized && s.layoutBackup) {
        const tabs = s.tabs.map((t) =>
          t.id === tab.id ? { ...t, layout: s.layoutBackup!, activePaneId: pane.id } : t,
        );
        set({ tabs, focusMaximized: false, layoutBackup: null });
        get().toastMsg("已还原分屏布局");
        return;
      }
      if (countLeaves(tab.layout) <= 1) {
        get().toastMsg("仅一个窗格，无需最大化");
        return;
      }
      const solo: LeafPane = { ...pane };
      const tabs = s.tabs.map((t) =>
        t.id === tab.id ? { ...t, layout: solo, activePaneId: solo.id } : t,
      );
      set({ tabs, focusMaximized: true, layoutBackup: tab.layout });
      get().toastMsg(`已最大化焦点窗格 #${pane.serial}`);
    },

    applyLayoutTemplate: (templateId) => {
      void import("../lib/layoutTemplates").then(({ getTemplate }) => {
        const t = getTemplate(templateId);
        if (!t) {
          get().toastMsg("未知布局模板");
          return;
        }
        const tab = get().activeTab();
        if (!tab) return;
        disposeLayoutSessions([
          tab.layout,
          get().focusMaximized ? get().layoutBackup : null,
        ]);
        const settings = useSettingsStore.getState();
        const meta = shellMeta(tab.shellKey);
        const baseKey = mockShellKey(tab.shellKey);
        // Templates renumber panes from #1 within this tab
        let ser = 1;
        const built = t.build({
          nextId: () => nextId("pane"),
          nextSerial: () => ser++,
          shellKey: baseKey,
          cwd: settings.cwd || meta.defaultCwd,
        });
        const tabs = get().tabs.map((x) =>
          x.id === tab.id
            ? {
                ...x,
                layout: built.layout,
                activePaneId: built.activePaneId,
                title: `${meta.name} · ${t.name}`,
              }
            : x,
        );
        set({
          tabs,
          activePaneId: built.activePaneId,
          focusMaximized: false,
          layoutBackup: null,
        });
        get().toastMsg(`已应用模板 · ${t.name}`);
      });
    },

    saveCurrentAsTemplate: (name) => {
      const tab = get().activeTab();
      if (!tab) return;
      void import("../lib/customTemplates").then(({ addCustomTemplate, loadCustomTemplates }) => {
        const atCap = loadCustomTemplates().length >= 30;
        const tpl = addCustomTemplate(name, tab.layout);
        get().toastMsg(
          atCap
            ? `已保存模板 · ${tpl.name}（已达 30 个上限，最旧模板被移除）`
            : `已保存布局模板 · ${tpl.name}`,
        );
      });
    },

    applyCustomTemplate: (id) => {
      void import("../lib/customTemplates").then(({ loadCustomTemplates, rehydrateLayout }) => {
        const tpl = loadCustomTemplates().find((t) => t.id === id);
        if (!tpl) {
          get().toastMsg("自定义模板不存在");
          return;
        }
        const tab = get().activeTab();
        if (!tab) return;
        disposeLayoutSessions([
          tab.layout,
          get().focusMaximized ? get().layoutBackup : null,
        ]);
        let ser = 1;
        const built = rehydrateLayout(tpl.layout, () => nextId("pane"), () => ser++);
        const tabs = get().tabs.map((x) =>
          x.id === tab.id
            ? {
                ...x,
                layout: built.layout,
                activePaneId: built.activePaneId,
                title: `${shellMeta(tab.shellKey).name} · ${tpl.name}`,
              }
            : x,
        );
        set({
          tabs,
          activePaneId: built.activePaneId,
          focusMaximized: false,
          layoutBackup: null,
        });
        get().toastMsg(`已应用自定义模板 · ${tpl.name}`);
      });
    },

    saveWorkspace: (name) => {
      void import("../lib/workspace").then(({ upsertWorkspace }) => {
        const s = get();
        const settings = useSettingsStore.getState();
        const now = new Date().toISOString();
        const ws = {
          id: nextId("ws"),
          name: name.trim() || "未命名工作区",
          createdAt: now,
          updatedAt: now,
          defaultShell: settings.defaultShell,
          defaultCwd: settings.cwd,
          defaultModelId: settings.aiDefaultModelId || s.aiModel,
          tabs: stripTabsRuntime(s.tabs),
          activeTabId: s.activeTabId,
          activePaneId: s.activePaneId,
          nextSerial: s.nextSerial,
          aiOpen: s.aiOpen,
          aiWidth: s.aiWidth,
        };
        upsertWorkspace(ws);
        get().toastMsg(`工作区已保存 · ${ws.name}`);
      });
    },

    switchWorkspace: (id) => {
      void import("../lib/workspace").then(({ getWorkspace, loadWorkspaces, saveWorkspaces }) => {
        const ws = getWorkspace(id);
        if (!ws) {
          get().toastMsg("工作区不存在");
          return;
        }
        const cur = get();
        disposeLayoutSessions([
          ...cur.tabs.map((t) => t.layout),
          cur.focusMaximized ? cur.layoutBackup : null,
        ]);
        set({
          tabs: stripTabsRuntime(ws.tabs),
          activeTabId: ws.activeTabId,
          activePaneId: ws.activePaneId,
          nextSerial: ws.nextSerial,
          aiOpen: ws.aiOpen ?? true,
          aiWidth: ws.aiWidth ?? 360,
          focusMaximized: false,
          layoutBackup: null,
        });
        const store = loadWorkspaces();
        store.activeId = id;
        saveWorkspaces(store);
        if (ws.defaultCwd) useSettingsStore.getState().patch({ cwd: ws.defaultCwd });
        get().toastMsg(`已切换工作区 · ${ws.name}`);
      });
    },

    listWorkspaces: () => {
      try {
        // sync read for palette
        const raw = localStorage.getItem("sw-workspaces-v1");
        if (!raw) return [];
        const data = JSON.parse(raw) as { workspaces?: { id: string; name: string }[] };
        return (data.workspaces || []).map((w) => ({ id: w.id, name: w.name }));
      } catch {
        return [];
      }
    },

    newAgentSession: () => {
      const s = get();
      const cur = s.agentSessions.find((x) => x.id === s.activeAgentSessionId);
      if (cur && cur.messages.filter((m) => m.role === "user").length === 0) {
        get().toastMsg("已在空会话中");
        return;
      }
      const session = emptyAgentSession(s.aiModel, s.aiEffort);
      set({
        agentSessions: [session, ...s.agentSessions],
        activeAgentSessionId: session.id,
      });
      get().toastMsg("已新建 Agent 会话");
    },

    switchAgentSession: (id) => {
      if (!get().agentSessions.some((x) => x.id === id)) return;
      if (get().agentBusy) {
        get().toastMsg("生成中，请先停止再切换会话");
        return;
      }
      set({ activeAgentSessionId: id });
    },

    deleteAgentSession: (id) => {
      const s = get();
      let agentSessions = s.agentSessions.filter((x) => x.id !== id);
      let activeAgentSessionId = s.activeAgentSessionId;
      if (agentSessions.length === 0) {
        const session = emptyAgentSession(s.aiModel, s.aiEffort);
        agentSessions = [session];
        activeAgentSessionId = session.id;
      } else if (activeAgentSessionId === id) {
        activeAgentSessionId = agentSessions[0].id;
      }
      set({ agentSessions, activeAgentSessionId });
    },

    appendAgentMessage: (msg, sessionId) => {
      const s = get();
      const sid = sessionId || s.activeAgentSessionId;
      if (!sid) return;
      if (!s.agentSessions.some((x) => x.id === sid)) return;
      const full: AiMessage = {
        id: msg.id ?? nextId("msg"),
        role: msg.role,
        content: msg.content,
        html: msg.html,
        thinking: msg.thinking,
        actions: msg.actions,
        actionsConsumed: msg.actionsConsumed,
        toolTrace: msg.toolTrace,
        cmd: msg.cmd,
        targetSerial: msg.targetSerial,
        createdAt: new Date().toISOString(),
      };
      const agentSessions = s.agentSessions.map((sess) => {
        if (sess.id !== sid) return sess;
        const messages = [...sess.messages, full];
        let title = sess.title;
        if (msg.role === "user" && (title === "新会话" || !title)) {
          title = msg.content.slice(0, 32) + (msg.content.length > 32 ? "…" : "");
        }
        return {
          ...sess,
          title,
          updatedAt: full.createdAt,
          messages,
          modelId: s.aiModel || sess.modelId,
          effortId: s.aiEffort,
        };
      });
      set({ agentSessions });
    },

    clearActiveAgentMessages: () => {
      const s = get();
      const sid = s.activeAgentSessionId;
      if (!sid) return;
      const agentSessions = s.agentSessions.map((sess) =>
        sess.id === sid
          ? {
              ...sess,
              messages: [],
              title: "新会话",
              updatedAt: new Date().toISOString(),
            }
          : sess,
      );
      set({ agentSessions });
      get().toastMsg("已清空当前会话");
    },

    markActionsConsumed: (messageId) => {
      const s = get();
      const sid = s.activeAgentSessionId;
      if (!sid) return;
      const agentSessions = s.agentSessions.map((sess) => {
        if (sess.id !== sid) return sess;
        return {
          ...sess,
          messages: sess.messages.map((m) =>
            m.id === messageId ? { ...m, actionsConsumed: true } : m,
          ),
        };
      });
      set({ agentSessions });
    },

    setAgentBusy: (agentBusy) => set({ agentBusy }),
    setAgentStreamId: (agentStreamId) => set({ agentStreamId }),

    getActiveAgentSession: () => {
      const s = get();
      return s.agentSessions.find((x) => x.id === s.activeAgentSessionId) ?? null;
    },
  };
});

/** Pull models from settings endpoint and re-select default (called on bootstrap). */
async function refreshModelsOnBootstrap() {
  const settings = useSettingsStore.getState();
  const endpoint = settings.aiEndpoint.trim().replace(/\/$/, "");
  if (!endpoint || !settings.aiApiKey.trim()) {
    useWorkbenchStore.setState({
      aiModelsStatus: endpoint ? "请填写 API Key" : "请先在设置中填写 API 端点",
    });
    return;
  }
  useWorkbenchStore.setState({ aiModelsStatus: "加载中…" });
  try {
    const { agentModelsList } = await import("../ipc/pty");
    const models = await agentModelsList(endpoint, settings.aiApiKey, settings.aiProvider);
    const cur = useWorkbenchStore.getState().aiModel;
    const keep =
      models.find((m) => m.id === settings.aiDefaultModelId) ||
      models.find((m) => m.id === cur) ||
      models[0];
    useWorkbenchStore.setState({
      aiModels: models,
      aiModelsStatus: `已加载 ${models.length} 个 · 启动时`,
      aiModel: keep?.id || cur || "",
    });
    if (keep?.id && settings.aiDefaultModelId !== keep.id && !settings.aiDefaultModelId) {
      useSettingsStore.getState().patch({ aiDefaultModelId: keep.id });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    useWorkbenchStore.setState({
      aiModels: [],
      aiModelsStatus: `失败：${msg}`,
    });
  }
}
