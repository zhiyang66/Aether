import { collectLeaves, layoutSummary, type LeafPane, type Tab } from "./layout";
import { shellMeta } from "./layout";
import type { SettingsState } from "../store/settingsStore";
import { getPaneOutput } from "./paneRegistry";
import { maxCharsForContextLines, redactAndTrimContext } from "./contextRedact";

export type PaneContext = {
  /** Global pane ref for Agent: T{tabIndex}:#{serial} e.g. T1:#2 */
  ref: string;
  tabIndex: number;
  tabId: string;
  tabTitle: string;
  serial: number;
  paneId: string;
  shellKey: string;
  cwd: string;
  isFocused: boolean;
  isActiveTab: boolean;
  draftInput: string;
  commandHistory: string[];
  scrollback: string;
  lastCommand?: string;
};

export type TabSummary = {
  tabIndex: number;
  tabId: string;
  title: string;
  paneCount: number;
  shellKey: string;
  isActive: boolean;
  layoutSummary: string;
};

export function buildContextBundle(
  tabs: Tab[],
  activeTabId: string | null,
  activePaneId: string | null,
  settings: Pick<SettingsState, "contextScope" | "includeDraft" | "contextLines">,
) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const scope = settings.contextScope;
  // Always build full tab index for Agent awareness
  const tabSummaries: TabSummary[] = tabs.map((tab, i) => {
    const leaves = collectLeaves(tab.layout);
    return {
      tabIndex: i + 1,
      tabId: tab.id,
      title: tab.title,
      paneCount: leaves.length,
      shellKey: tab.shellKey,
      isActive: tab.id === activeTab?.id,
      layoutSummary: layoutSummary(tab.layout),
    };
  });

  const allLeaves: { tab: Tab; tabIndex: number; leaf: LeafPane }[] = [];
  tabs.forEach((tab, i) => {
    if (scope === "activeTab" && activeTab && tab.id !== activeTab.id) return;
    for (const leaf of collectLeaves(tab.layout)) {
      if (scope === "focus" && leaf.id !== activePaneId) continue;
      allLeaves.push({ tab, tabIndex: i + 1, leaf });
    }
  });

  // For "allTabs" or default product: include all panes when scope is allTabs
  // When activeTab, still include tabSummaries for all tabs so Agent knows count
  const focusLeaf =
    (activeTab &&
      activePaneId &&
      collectLeaves(activeTab.layout).find((l) => l.id === activePaneId)) ||
    (activeTab && collectLeaves(activeTab.layout)[0]) ||
    null;
  const focusTabIndex = activeTab
    ? tabs.findIndex((t) => t.id === activeTab.id) + 1
    : 0;

  const lines = Math.min(120, Math.max(20, settings.contextLines || 40));
  const maxChars = maxCharsForContextLines(lines);
  const panes: PaneContext[] = allLeaves.map(({ tab, tabIndex, leaf }) => {
    const live = getPaneOutput(leaf.id, lines);
    const rawScroll =
      live.trim().length > 0
        ? live
        : leaf.history
            .slice(-lines)
            .map((l) => l.text)
            .join("\n");
    const scroll = redactAndTrimContext(rawScroll, maxChars);
    const draftRaw = settings.includeDraft ? leaf.draft : "";
    return {
      ref: `T${tabIndex}:#${leaf.serial}`,
      tabIndex,
      tabId: tab.id,
      tabTitle: tab.title,
      serial: leaf.serial,
      paneId: leaf.id,
      shellKey: leaf.shellKey,
      cwd: leaf.cwd,
      isFocused: leaf.id === focusLeaf?.id,
      isActiveTab: tab.id === activeTab?.id,
      draftInput: redactAndTrimContext(draftRaw, 500),
      commandHistory: leaf.cmdHistory
        .slice(-12)
        .map((c) => redactAndTrimContext(c, 200))
        .filter(Boolean),
      scrollback: scroll,
      lastCommand: leaf.cmdHistory[leaf.cmdHistory.length - 1]
        ? redactAndTrimContext(leaf.cmdHistory[leaf.cmdHistory.length - 1], 200)
        : undefined,
    };
  });

  const paneIndex = panes.map((p) => ({
    ref: p.ref,
    tabIndex: p.tabIndex,
    serial: p.serial,
    shellKey: p.shellKey,
    cwd: p.cwd,
  }));

  const tabsLine = tabSummaries
    .map(
      (t) =>
        `T${t.tabIndex}${t.isActive ? "*" : ""} 「${t.title}」 ${t.paneCount}窗格 layout=${t.layoutSummary}`,
    )
    .join(" | ");

  return {
    focusSerial: focusLeaf?.serial ?? 0,
    focusTabIndex,
    focusRef: focusLeaf ? `T${focusTabIndex}:#${focusLeaf.serial}` : "",
    tabCount: tabs.length,
    tabs: tabSummaries,
    tabsLine,
    layoutSummary: activeTab ? layoutSummary(activeTab.layout) : "",
    paneIndex,
    panes,
  };
}

export function parseTargetSerial(text: string): number | undefined {
  // T2:#1 or #1
  const tm = text.match(/T\d+:#(\d+)/i);
  if (tm) return Number(tm[1]);
  const m =
    text.match(/#(\d+)/) || text.match(/窗格\s*(\d+)/i) || text.match(/pane\s*(\d+)/i);
  if (!m) return undefined;
  return Number(m[1]);
}

/** Local mock agent until real endpoint is configured. */
export function localAgentReply(
  userText: string,
  bundle: ReturnType<typeof buildContextBundle>,
  effort: string,
): { html: string; cmd?: string; targetSerial?: number } {
  const targetSerial = parseTargetSerial(userText) ?? bundle.focusSerial;
  const pane =
    bundle.panes.find((p) => p.serial === targetSerial && p.isFocused) ||
    bundle.panes.find((p) => p.serial === targetSerial) ||
    bundle.panes.find((p) => p.isFocused) ||
    bundle.panes[0];
  const tag = pane ? pane.ref : "#?";
  const shellName = pane ? shellMeta(pane.shellKey).name : "";

  let body = "";
  let cmd: string | undefined;

  if (/标签|打开了几个|多少.*标签|tab/i.test(userText)) {
    body = `当前共 **${bundle.tabCount}** 个标签页：\n\n${bundle.tabs
      .map(
        (t) =>
          `- **T${t.tabIndex}**${t.isActive ? "（当前）" : ""} ${t.title} · ${t.paneCount} 窗格 · ${t.layoutSummary}`,
      )
      .join("\n")}\n\n焦点：\`${bundle.focusRef}\``;
  } else if (/当前.*窗格|窗格几|focus/i.test(userText)) {
    body = `你当前在 **${bundle.focusRef}**（焦点）。\n\n标签概览：${bundle.tabsLine}\n\n当前标签布局：\`${bundle.layoutSummary}\``;
  } else if (/端口|port|占用/i.test(userText)) {
    cmd =
      pane && (pane.shellKey === "ps" || pane.shellKey === "cmd")
        ? "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort | Format-Table -AutoSize"
        : "ss -tulpn | head -n 20";
    body = `在 \`${tag}\`（${shellName}）查看监听端口：`;
  } else if (/大小|排序|size/i.test(userText)) {
    cmd =
      pane && (pane.shellKey === "ps" || pane.shellKey === "cmd")
        ? "Get-ChildItem | Sort-Object Length -Descending | Format-Table Mode,Length,Name"
        : "ls -lhS";
    body = `在 \`${tag}\` 按大小列目录：`;
  } else {
    cmd =
      pane && (pane.shellKey === "ps" || pane.shellKey === "cmd")
        ? "Get-Location; Get-ChildItem"
        : "pwd && ls -la";
    body = `收到：「${userText}」。焦点 \`${bundle.focusRef}\` · 共 ${bundle.tabCount} 个标签。建议确认环境：`;
  }

  if (effort === "high" || effort === "max") {
    body += `\n\n*（${effort === "max" ? "最高" : "高"}强度）*`;
  }

  // Return markdown; UI will render
  let md = body;
  if (cmd) md += `\n\n\`\`\`\n${cmd}\n\`\`\``;
  return { html: md, cmd, targetSerial: pane?.serial };
}
