import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./window";

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export const MAX_PASTED_IMAGE_BYTES = 8 * 1024 * 1024;

export type ClipboardImage = {
  mimeType: ImageMimeType;
  dataUrl: string;
  name: string;
};

function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

async function fileToClipboardImage(file: Blob, name = "pasted-image"): Promise<ClipboardImage | null> {
  const mimeType = file.type.toLowerCase();
  if (!isImageMimeType(mimeType)) return null;
  if (file.size <= 0 || file.size > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("图片须小于 8 MB，且格式为 PNG、JPEG、WebP 或 GIF");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取剪贴板图片失败"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
  return { mimeType, dataUrl, name };
}

export function clipboardHasImage(data: DataTransfer | null | undefined): boolean {
  return Array.from(data?.items ?? []).some((item) => isImageMimeType(item.type));
}

export async function readClipboardImageFromData(data: DataTransfer | null | undefined): Promise<ClipboardImage | null> {
  for (const item of Array.from(data?.items ?? [])) {
    if (!isImageMimeType(item.type)) continue;
    const file = item.getAsFile();
    if (file) return fileToClipboardImage(file, file.name || "pasted-image");
  }
  return null;
}

export async function readClipboardImage(): Promise<ClipboardImage | null> {
  if (!navigator.clipboard?.read) return null;
  const entries = await navigator.clipboard.read();
  for (const entry of entries) {
    const mimeType = entry.types.find((type) => isImageMimeType(type));
    if (!mimeType) continue;
    return fileToClipboardImage(await entry.getType(mimeType), "pasted-image");
  }
  return null;
}

export function dataUrlBase64(dataUrl: string): string {
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("无效图片数据");
  return match[1];
}

export async function savePastedImage(image: ClipboardImage): Promise<string> {
  if (!isTauri()) throw new Error("图片粘贴仅支持桌面客户端");
  return invoke<string>("save_pasted_image", {
    mimeType: image.mimeType,
    dataBase64: dataUrlBase64(image.dataUrl),
  });
}

export function quoteShellPath(path: string, shellKey: string): string {
  const shell = shellKey.toLowerCase();
  if (shell === "cmd") return `"${path.replace(/"/g, '""')}"`;
  if (shell === "ps" || shell.includes("powershell") || shell.includes("pwsh")) {
    return `'${path.replace(/'/g, "''")}'`;
  }
  return `'${path.replace(/'/g, "'\"'\"'")}'`;
}
