/**
 * Agent composer slash-commands — only for things that need typed arguments.
 * UI buttons cover: new session, clear, model picker, stop, task panel, history.
 */

export type AgentSlashCommand = {
  cmd: string;
  insert: string;
  label: string;
  desc: string;
  /** Always draft: fill composer for the user to complete */
  run: "draft";
};

export const AGENT_SLASH_COMMANDS: AgentSlashCommand[] = [
  {
    cmd: "/task",
    insert: "/task ",
    label: "/task",
    desc: "创建多步任务 · 写标题，可换行写步骤",
    run: "draft",
  },
  {
    cmd: "/focus",
    insert: "/focus ",
    label: "/focus",
    desc: "聚焦窗格 · 例 /focus 2",
    run: "draft",
  },
];

export function matchSlashCommands(input: string): AgentSlashCommand[] {
  const first = (input.split("\n")[0] ?? "").trimStart();
  if (!first.startsWith("/")) return [];

  const space = first.search(/\s/);
  const token = (space < 0 ? first : first.slice(0, space)).toLowerCase();
  if (!token.startsWith("/")) return [];

  if (space >= 0) {
    return AGENT_SLASH_COMMANDS.filter((c) => c.cmd === token);
  }
  if (token === "/") return [...AGENT_SLASH_COMMANDS];
  return AGENT_SLASH_COMMANDS.filter(
    (c) => c.cmd.startsWith(token) || c.label.toLowerCase().startsWith(token),
  );
}

/** Enter accepts menu only while completing the command token (no args yet). */
export function slashEnterShouldAccept(input: string, matches: AgentSlashCommand[]): boolean {
  if (!matches.length) return false;
  const first = (input.split("\n")[0] ?? "").trim();
  if (!first.startsWith("/")) return false;
  return /^\/\S*$/.test(first);
}
