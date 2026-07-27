import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { parseCast, readCastFile, type Cast } from "../lib/recording";
import { useWorkbenchStore } from "../store/workbenchStore";

/**
 * 1.0 会话回放：只读 xterm + 进度条 / 倍速 / 暂停。
 * Opened via window event `sw:open-cast` with { path } detail.
 */
export function CastPlayer() {
  const [path, setPath] = useState<string | null>(null);
  const [cast, setCast] = useState<Cast | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pos, setPos] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const idxRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const posRef = useRef(0);
  const speedRef = useRef(1);
  speedRef.current = speed;

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const d = (ev as CustomEvent<{ path: string }>).detail;
      if (d?.path) setPath(d.path);
    };
    window.addEventListener("sw:open-cast", onOpen);
    return () => window.removeEventListener("sw:open-cast", onOpen);
  }, []);

  // Load + mount terminal when a path arrives
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const text = await readCastFile(path);
        const parsed = parseCast(text);
        if (cancelled) return;
        setCast(parsed);
        setPos(0);
        posRef.current = 0;
        idxRef.current = 0;
        setPlaying(true);
      } catch (e) {
        useWorkbenchStore
          .getState()
          .toastMsg(`打开录像失败: ${e instanceof Error ? e.message : e}`);
        setPath(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (!cast || !hostRef.current) return;
    const term = new Terminal({
      cols: cast.width,
      rows: cast.height,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 13,
      scrollback: 5000,
      theme: { background: "#101318" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
    termRef.current = term;
    return () => {
      term.dispose();
      termRef.current = null;
    };
  }, [cast]);

  // Playback clock: advance posRef, flush due events
  useEffect(() => {
    if (!playing || !cast) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      posRef.current += ((now - last) / 1000) * speedRef.current;
      last = now;
      const term = termRef.current;
      while (
        term &&
        idxRef.current < cast.events.length &&
        cast.events[idxRef.current].t <= posRef.current
      ) {
        const ev = cast.events[idxRef.current++];
        if (ev.code === "o") term.write(ev.data);
        else if (ev.code === "r") {
          const m = ev.data.match(/^(\d+)x(\d+)$/);
          if (m) {
            try {
              term.resize(Number(m[1]), Number(m[2]));
            } catch {
              /* ignore */
            }
          }
        }
      }
      setPos(Math.min(posRef.current, cast.duration));
      if (idxRef.current >= cast.events.length) {
        setPlaying(false);
        return;
      }
      timerRef.current = window.setTimeout(tick, 33);
    };
    timerRef.current = window.setTimeout(tick, 33);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, cast]);

  if (!path || !cast) return null;

  const close = () => {
    setPlaying(false);
    setPath(null);
    setCast(null);
  };

  const seek = (target: number) => {
    const term = termRef.current;
    if (!term) return;
    // Rebuild from start (cheap enough at cast sizes we cap)
    term.reset();
    idxRef.current = 0;
    posRef.current = target;
    for (const ev of cast.events) {
      if (ev.t > target) break;
      idxRef.current++;
      if (ev.code === "o") term.write(ev.data);
    }
    setPos(target);
  };

  return (
    <div
      className="cmd-palette-backdrop app-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cast-player" role="dialog" aria-label="会话回放">
        <div className="cast-player-head">
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12,
              color: "var(--muted)",
            }}
            title={path}
          >
            {path}
          </span>
          <button type="button" className="pane-close" aria-label="关闭" onClick={close}>
            ×
          </button>
        </div>
        <div className="cast-player-term" ref={hostRef} />
        <div className="cast-player-bar">
          <button
            type="button"
            className="term-search-btn"
            onClick={() => {
              if (!playing && idxRef.current >= cast.events.length) seek(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={cast.duration}
            step={0.1}
            value={pos}
            style={{ flex: 1 }}
            onChange={(e) => {
              setPlaying(false);
              seek(Number(e.target.value));
            }}
          />
          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 76 }}>
            {pos.toFixed(1)}s / {cast.duration.toFixed(1)}s
          </span>
          <select
            className="ctrl"
            style={{ width: 64, fontSize: 12 }}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.5, 1, 1.5, 2, 4].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
