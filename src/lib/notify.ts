/**
 * System notification helper (Tauri notification plugin).
 * No-ops silently outside Tauri or when permission is denied.
 */

import { isTauri } from "./window";

export async function sendNotify(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const {
      isPermissionGranted,
      requestPermission,
      sendNotification,
    } = await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch {
    /* notification is best-effort */
  }
}
