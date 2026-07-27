import { useEffect, useState } from "react";
import {
  addRule,
  loadApproval,
  onApprovalChanged,
  PRESET_LABELS,
  removeRule,
  setPreset,
  type ApprovalPreset,
  type ApprovalScope,
  type ApprovalStore,
} from "../../lib/approval";
import { useWorkbenchStore } from "../../store/workbenchStore";

const SCOPE_LABEL: Record<ApprovalScope, string> = {
  tool: "工具",
  "command-pattern": "命令",
  "mcp-server": "MCP",
};

/** 1.0 审批体系设置：预设档 + 规则管理（可审计、可撤销）。 */
export function ApprovalPanel() {
  const toastMsg = useWorkbenchStore((s) => s.toastMsg);
  const [store, setStore] = useState<ApprovalStore>(() => loadApproval());
  const [scope, setScope] = useState<ApprovalScope>("command-pattern");
  const [key, setKey] = useState("");
  const [decision, setDecision] = useState<"allow" | "deny" | "ask">("allow");

  useEffect(() => onApprovalChanged(() => setStore(loadApproval())), []);

  return (
    <div className="section">
      <div className="section-title">策略预设</div>
      <div className="card pad">
        {(Object.keys(PRESET_LABELS) as ApprovalPreset[]).map((p) => (
          <label
            key={p}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 0",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="approval-preset"
              checked={store.preset === p}
              onChange={() => {
                setPreset(p);
                toastMsg(`审批预设 · ${PRESET_LABELS[p]}`);
              }}
            />
            <span>{PRESET_LABELS[p]}</span>
          </label>
        ))}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          规则优先于预设（自上而下第一条命中生效）。危险命令即使预设放行也会升级为询问，除非有明确的允许规则。
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        规则（{store.rules.length}） · 审批弹窗点「总是允许」也会写入这里
      </div>
      <div className="card pad">
        {store.rules.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            暂无规则。命令支持通配符：<code>npm *</code> 匹配所有 npm 命令。
          </div>
        )}
        {store.rules.map((r) => (
          <div
            key={`${r.scope}-${r.key}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              className={`status-pill${
                r.decision === "allow" ? " ok" : r.decision === "deny" ? " warn" : ""
              }`}
            >
              {r.decision === "allow" ? "放行" : r.decision === "deny" ? "拒绝" : "询问"}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 36 }}>
              {SCOPE_LABEL[r.scope]}
            </span>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 12,
              }}
            >
              {r.key}
            </code>
            <button
              className="btn"
              type="button"
              onClick={() => {
                removeRule(r.scope, r.key);
                toastMsg("已删除规则");
              }}
            >
              删除
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <select
            className="ctrl"
            value={scope}
            onChange={(e) => setScope(e.target.value as ApprovalScope)}
            style={{ width: 90 }}
          >
            <option value="command-pattern">命令</option>
            <option value="tool">工具</option>
            <option value="mcp-server">MCP</option>
          </select>
          <input
            className="ctrl mono"
            style={{ flex: 1, minWidth: 160 }}
            placeholder={
              scope === "command-pattern"
                ? "命令模式，如 npm * 或 git status"
                : scope === "tool"
                  ? "工具名，如 run_command"
                  : "MCP server 名"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <select
            className="ctrl"
            value={decision}
            onChange={(e) => setDecision(e.target.value as "allow" | "deny" | "ask")}
            style={{ width: 90 }}
          >
            <option value="allow">放行</option>
            <option value="ask">询问</option>
            <option value="deny">拒绝</option>
          </select>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              if (!key.trim()) {
                toastMsg("请填写规则内容");
                return;
              }
              addRule({ scope, key: key.trim(), decision });
              setKey("");
              toastMsg("已添加规则");
            }}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
