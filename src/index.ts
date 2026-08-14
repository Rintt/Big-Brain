export { run } from "./core/run.js";

export type AgentProvider = { type: "opencode"; command: string };

export function opencode(): AgentProvider {
  return { type: "opencode", command: "opencode run --format json --model openai/gpt-5.5" };
}
