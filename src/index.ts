export { run } from "./core/run.js";

export type AgentProvider = { type: "opencode" };

export function opencode(): AgentProvider {
  return { type: "opencode" };
}
