export { run } from "./core/run.js";
export type AgentProvider = {
    type: "opencode";
    command: string;
};
export declare function opencode(): AgentProvider;
