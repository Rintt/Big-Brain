export type BranchStrategy = {
    type: "head";
} | {
    type: "branch";
    branch: string;
};
export type RunOptions = {
    cwd: string;
    name: string;
    prompt: string;
    branchStrategy?: BranchStrategy;
    agentCommand?: string;
    executionMode?: "docker" | "direct";
    completionSignal?: string;
};
export type RunResult = {
    id: string;
    status: "completed" | "failed";
    logPath: string;
    resultPath: string;
};
export declare function run(options: RunOptions): Promise<RunResult>;
