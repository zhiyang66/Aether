import { useEffect, useMemo, useState } from "react";
import { querySuggestions } from "../lib/commandHistory";
import { useSettingsStore } from "../store/settingsStore";

/** Floating suggestions over real xterm (V1.2). */
export function XtermSuggest({
  open,
  prefix,
  shellKey,
  onPick,
  onClose,
}: {
  open: boolean;
  prefix: string;
  shellKey: string;
  onPick: (cmd: string, run: boolean) => void;
  onClose: () => void;
}) {
  const settings = useSettingsStore();
  const [idx, setIdx] = useState(0);

  const items = useMemo(() => {
    if (!open || !settings.suggestEnabled || !prefix.trim()) return [];
    return querySuggestions(prefix, shellKey, {
      max: settings.suggestMax,
      useHistory: settings.suggestHistory,
      useFrequent: settings.suggestFrequent,
      byShell: settings.historyByShell,
      fuzzy: settings.suggestFuzzy,
    });
  }, [
    open,
    prefix,
    shellKey,
    settings.suggestEnabled,
    settings.suggestMax,
    settings.suggestHistory,
    settings.suggestFrequent,
    settings.historyByShell,
    settings.suggestFuzzy,
  ]);

  useEffect(() => setIdx(0), [prefix, items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onPick(items[idx].cmd, false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, idx, onPick, onClose]);

  if (!open || items.length === 0) return null;

  return (
    <div className="xterm-suggest" role="listbox">
      {items.map((item, i) => (
        <button
          key={item.cmd + i}
          type="button"
          role="option"
          aria-selected={i === idx}
          className={`xterm-suggest-item${i === idx ? " active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item.cmd, settings.suggestAccept === "run");
          }}
        >
          <span className="xterm-suggest-cmd">{item.cmd}</span>
          <span className="xterm-suggest-meta">
            {item.source}
            {item.count > 1 ? ` · ${item.count}×` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
