import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/**
 * In-app replacement for window.confirm / window.prompt.
 * Native blocking dialogs freeze the Tauri WebView (see workbenchStore
 * requestAppClose) — every confirmation in the app must go through here.
 *
 * Scopes:
 * - confirm / prompt → full-app overlay (App root)
 * - approval (Agent tools) → confined to the Agent panel only
 */

type DialogKind = "confirm" | "prompt" | "approval";

type DialogRequest = {
  id: string;
  kind: DialogKind;
  title: string;
  message?: string;
  /** prompt only */
  defaultValue?: string;
  placeholder?: string;
  /** confirm styling: highlight the OK button as destructive */
  danger?: boolean;
  okLabel?: string;
  cancelLabel?: string;
  /** approval only: monospace payload (command / tool args) */
  detail?: string;
  resolve: (value: string | boolean | null) => void;
};

type DialogState = {
  queue: DialogRequest[];
  push: (req: DialogRequest) => void;
  remove: (id: string) => void;
};

const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  push: (req) => set((s) => ({ queue: [...s.queue, req] })),
  remove: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
}));

let seq = 0;

export type ConfirmOptions = {
  message?: string;
  danger?: boolean;
  okLabel?: string;
  cancelLabel?: string;
};

/** Resolves true (OK) / false (cancel or ESC). */
export function askConfirm(title: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: `dlg-${++seq}`,
      kind: "confirm",
      title,
      message: opts.message,
      danger: opts.danger,
      okLabel: opts.okLabel,
      cancelLabel: opts.cancelLabel,
      resolve: (v) => resolve(v === true),
    });
  });
}

export type PromptOptions = {
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
};

/** Resolves the entered string, or null on cancel/ESC. */
export function askPrompt(title: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: `dlg-${++seq}`,
      kind: "prompt",
      title,
      message: opts.message,
      defaultValue: opts.defaultValue,
      placeholder: opts.placeholder,
      okLabel: opts.okLabel,
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    });
  });
}

export type ApprovalAnswer = "once" | "always" | "deny";

export type ApprovalDialogOptions = {
  /** e.g. "Agent 想执行命令" */
  message?: string;
  /** full command / tool args, rendered monospace */
  detail?: string;
  /** danger highlight + reason line */
  danger?: boolean;
};

/**
 * 1.0 审批弹窗: 允许一次 / 总是允许（写入规则）/ 拒绝。
 * ESC / backdrop = deny. Renders only inside the Agent panel.
 */
export function askApproval(
  title: string,
  opts: ApprovalDialogOptions = {},
): Promise<ApprovalAnswer> {
  // Ensure the Agent side panel is open so the in-panel dialog is visible.
  try {
    // Lazy import avoids circular deps with workbenchStore ↔ agentToolLoop
    void import("../store/workbenchStore").then(({ useWorkbenchStore }) => {
      const st = useWorkbenchStore.getState();
      if (!st.aiOpen) st.setAiOpen(true);
    });
  } catch {
    /* ignore */
  }
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: `dlg-${++seq}`,
      kind: "approval",
      title,
      message: opts.message,
      detail: opts.detail,
      danger: opts.danger,
      resolve: (v) =>
        resolve(v === "once" || v === "always" ? (v as ApprovalAnswer) : "deny"),
    });
  });
}

export type DialogHostProps = {
  /** Which kinds this host claims (default: confirm + prompt at app root). */
  kinds?: DialogKind[];
  /**
   * Layout variant:
   * - `app` (default): fixed full-window overlay
   * - `panel`: absolute fill of nearest positioned ancestor (Agent panel)
   */
  variant?: "app" | "panel";
};

/**
 * Mount once per scope. App root: kinds confirm/prompt.
 * Agent panel: kinds approval, variant panel.
 */
export function AppDialogHost({
  kinds = ["confirm", "prompt"],
  variant = "app",
}: DialogHostProps) {
  const current = useDialogStore(
    (s) => s.queue.find((q) => kinds.includes(q.kind)) ?? null,
  );
  const remove = useDialogStore((s) => s.remove);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    setValue(current.defaultValue ?? "");
    // Focus after paint: input for prompt, OK button otherwise
    const t = window.setTimeout(() => {
      if (current.kind === "prompt") inputRef.current?.select();
      else okRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [current]);

  if (!current) return null;

  const finish = (v: string | boolean | null) => {
    current.resolve(v);
    remove(current.id);
  };

  const cancelValue = () =>
    current.kind === "prompt" ? null : current.kind === "approval" ? "deny" : false;

  const submit = () => {
    if (current.kind === "prompt") finish(value);
    else if (current.kind === "approval") finish("once");
    else finish(true);
  };

  const backdropClass =
    variant === "panel"
      ? "app-dialog-backdrop app-dialog-backdrop-panel"
      : "cmd-palette-backdrop app-dialog-backdrop";

  return (
    <div
      className={backdropClass}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish(cancelValue());
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(cancelValue());
        }
      }}
    >
      <div
        className={`app-dialog${variant === "panel" ? " app-dialog-panel" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
      >
        <div className="app-dialog-title">{current.title}</div>
        {current.message && <div className="app-dialog-message">{current.message}</div>}
        {current.kind === "approval" && current.detail && (
          <pre className={`app-dialog-detail${current.danger ? " danger" : ""}`}>
            {current.detail}
          </pre>
        )}
        {current.kind === "prompt" && (
          <input
            ref={inputRef}
            className="app-dialog-input"
            value={value}
            placeholder={current.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
        {current.kind === "approval" ? (
          <div className="app-dialog-actions">
            <button type="button" className="app-dialog-btn" onClick={() => finish("deny")}>
              拒绝
            </button>
            <button
              type="button"
              className="app-dialog-btn"
              title="写入允许规则（设置 → 审批 可撤销）"
              onClick={() => finish("always")}
            >
              总是允许
            </button>
            <button
              ref={okRef}
              type="button"
              className={`app-dialog-btn primary${current.danger ? " danger" : ""}`}
              onClick={() => finish("once")}
            >
              允许一次
            </button>
          </div>
        ) : (
          <div className="app-dialog-actions">
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => finish(cancelValue())}
            >
              {current.cancelLabel ?? "取消"}
            </button>
            <button
              ref={okRef}
              type="button"
              className={`app-dialog-btn primary${current.danger ? " danger" : ""}`}
              onClick={submit}
            >
              {current.okLabel ?? "确定"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
