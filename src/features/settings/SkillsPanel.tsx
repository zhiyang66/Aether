import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/window";
import { getSkills, refreshSkills, type AgentSkill } from "../../lib/agentSkills";

/**
 * Read-only view of the Agent skills (capability briefs injected into the system
 * prompt at send time). Skills live on disk as `~/.aether/skills/<id>/SKILL.md`
 * (YAML frontmatter + markdown); built-ins are seeded there on first run and the
 * user can edit or add their own. There is no per-skill toggle or in-app editor
 * yet — this panel just shows what the Agent has been taught it can do.
 */
export function SkillsPanel() {
  const [skills, setSkills] = useState<AgentSkill[]>(getSkills());
  const [dir, setDir] = useState("~/.aether/skills");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setBusy(true);
    try {
      setSkills(await refreshSkills());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
    if (isTauri()) {
      invoke<string>("skills_dir_path")
        .then(setDir)
        .catch(() => {});
    }
  }, []);

  return (
    <div className="section">
      <div
        className="section-title"
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <span>Skill（{skills.length}）</span>
        <button
          className="btn ghost"
          style={{ marginLeft: "auto", fontSize: 12 }}
          onClick={() => void reload()}
          disabled={busy}
        >
          {busy ? "刷新中…" : "刷新"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 8px" }}>
        Skill 是「告知 Agent 如何操作本软件」的能力简报，随每次对话自动注入系统提示。
        存于 <code>{dir}</code>（首次运行自动生成内置）；可直接编辑或新增 <code>&lt;id&gt;/SKILL.md</code>，
        重启后生效。Agent 也能通过 <code>skill_manage</code> 帮你创建/更新 Skill（写操作需审批）。
      </p>
      <div className="card pad">
        {skills.map((s) => (
          <div key={s.id} className="row" style={{ alignItems: "flex-start" }}>
            <div className="row-text">
              <div
                className="row-label"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                {s.title}
                {s.category && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "1px 6px",
                    }}
                  >
                    {s.category}
                  </span>
                )}
                {s.builtin === false && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--accent, #4ea1ff)",
                      border: "1px solid var(--accent, #4ea1ff)",
                      borderRadius: 4,
                      padding: "1px 6px",
                    }}
                  >
                    custom
                  </span>
                )}
              </div>
              <div className="row-desc">{s.summary ?? s.id}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
