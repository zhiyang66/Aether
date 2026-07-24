/**
 * OpenAI function-calling tool list lives in agentToolLoop.ts.
 * This module only re-exports skill-oriented prompt fragments if needed.
 */

export { SKILL_TOOLS as AGENT_TOOLS_PROMPT_SKILL } from "./agentSkills";

/** @deprecated use formatAgentSkillsPrompt — kept for import compatibility */
export const AGENT_TOOLS_PROMPT = "";

export type ClientToolName =
  | "run_command"
  | "read_pane"
  | "list_panes"
  | "run_in_pane"
  | "insert_in_pane"
  | "focus_pane";
