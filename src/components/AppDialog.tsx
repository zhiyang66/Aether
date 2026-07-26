import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/**
 * In-app replacement for window.confirm / window.prompt.
 * Native blocking dialogs freeze the Tauri WebView (see workbenchStore
 * requestAppClose) — every confirmation in the app must go through here.
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
  shift: () => void;
};

const useDialogStore = create<DialogState>((set) => ({
  queue: [],
  push: (req) => set((s) => ({ queue: [...s.queue, req] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
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
 * ESC / backdrop = deny.
 */
export function askApproval(
  title: string,
  opts: ApprovalDialogOptions = {},
): Promise<ApprovalAnswer> {
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

/** Mount once at app root. Renders the head of the dialog queue. */
export function AppDialogHost() {
  const current = useDialogStore((s) => s.queue[0] ?? null);
  const shift = useDialogStore((s) => s.shift);
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
    shift();
  };

  const cancelValue = () =>
    current.kind === "prompt" ? null : current.kind === "approval" ? "deny" : false;

  const submit = () => {
    if (current.kind === "prompt") finish(value);
    else if (current.kind === "approval") finish("once");
    else finish(true);
  };

  return (
    <div
      className="cmd-palette-backdrop app-dialog-backdrop"
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
      <div className="app-dialog" role="dialog" aria-modal="true" aria-label={current.title}>
        <div className="app-dialog-title">{current.title}</div>
        {current.message && <div className="app-dialog-message">{current.message}</div>}
        {current.kind === "approval" && current.detail && (
          <pre
            className={`app-dialog-detail${current.danger ? " danger" : ""}`}
          >
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
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => finish("deny")}
            >
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
