/**
 * Local extension hooks — load/save/import JSON manifests.
 */

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled?: boolean;
  agentSystemAppend?: string;
  commands?: { id: string; label: string; insertText?: string; runCommand?: string }[];
  defaultCwd?: string;
};

export const EXT_STORE_KEY = "sw-extensions-v1";

export const EXAMPLE_EXTENSION: ExtensionManifest = {
  id: "official.devtools",
  name: "Dev Tools Snippets",
  version: "1.0.0",
  enabled: true,
  description: "官方示例：常用 git / 诊断命令快捷插入",
  agentSystemAppend:
    "用户启用了 Dev Tools 扩展：优先给出可复制的 git 与诊断命令，并标注 #N 窗格。",
  commands: [
    { id: "git-status", label: "扩展: git status", runCommand: "git status" },
    { id: "git-diff", label: "扩展: git diff", runCommand: "git diff" },
    {
      id: "ports",
      label: "扩展: 查监听端口 (ps)",
      runCommand:
        "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort | Format-Table -AutoSize",
    },
  ],
};

export function loadExtensions(): ExtensionManifest[] {
  try {
    const raw = localStorage.getItem(EXT_STORE_KEY);
    if (!raw) return [{ ...EXAMPLE_EXTENSION }];
    const list = JSON.parse(raw) as ExtensionManifest[];
    if (!Array.isArray(list) || list.length === 0) return [{ ...EXAMPLE_EXTENSION }];
    return list.map((e) => ({ enabled: true, ...e }));
  } catch {
    return [{ ...EXAMPLE_EXTENSION }];
  }
}

export function saveExtensions(list: ExtensionManifest[]) {
  localStorage.setItem(EXT_STORE_KEY, JSON.stringify(list));
}

export function ensureExampleExtension() {
  const list = loadExtensions();
  if (!list.some((e) => e.id === EXAMPLE_EXTENSION.id)) {
    list.unshift({ ...EXAMPLE_EXTENSION });
    saveExtensions(list);
  }
  return list;
}

export function enabledExtensions(): ExtensionManifest[] {
  return loadExtensions().filter((e) => e.enabled !== false);
}

export function agentSystemFromExtensions(): string {
  return enabledExtensions()
    .map((e) => e.agentSystemAppend)
    .filter(Boolean)
    .join("\n");
}

export function allExtensionCommands(): {
  id: string;
  label: string;
  runCommand?: string;
  insertText?: string;
}[] {
  return enabledExtensions().flatMap((e) =>
    (e.commands || []).map((c) => ({
      ...c,
      id: `${e.id}:${c.id}`,
      label: c.label || `${e.name}: ${c.id}`,
    })),
  );
}

export function setExtensionEnabled(id: string, enabled: boolean) {
  const list = loadExtensions().map((e) => (e.id === id ? { ...e, enabled } : e));
  saveExtensions(list);
  return list;
}

export function removeExtension(id: string) {
  if (id === EXAMPLE_EXTENSION.id) {
    // allow disable but keep file — user can remove custom only? allow remove all
  }
  saveExtensions(loadExtensions().filter((e) => e.id !== id));
}

export function importExtensionJson(raw: string): ExtensionManifest {
  const data = JSON.parse(raw) as ExtensionManifest;
  if (!data?.id || !data?.name) throw new Error("扩展缺少 id/name");
  const list = loadExtensions().filter((e) => e.id !== data.id);
  const ext: ExtensionManifest = {
    id: data.id,
    name: data.name,
    version: data.version || "0.0.0",
    description: data.description,
    enabled: data.enabled !== false,
    agentSystemAppend: data.agentSystemAppend,
    commands: data.commands,
    defaultCwd: data.defaultCwd,
  };
  list.unshift(ext);
  saveExtensions(list);
  return ext;
}
