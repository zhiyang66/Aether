import { getCurrentWindow } from "@tauri-apps/api/window";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function winMinimize() {
  if (!isTauri()) return;
  await getCurrentWindow().minimize();
}

export async function winToggleMaximize() {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    await win.unmaximize();
    return false;
  }
  await win.maximize();
  return true;
}

export async function winClose() {
  if (!isTauri()) {
    window.close();
    return;
  }
  await getCurrentWindow().close();
}

export async function winIsMaximized(): Promise<boolean> {
  if (!isTauri()) return true;
  return getCurrentWindow().isMaximized();
}
