export declare const BIG_BRAIN_DIR = ".big-brain";
export declare const CONFIG_FILE = "config.json";
export declare const DB_FILE = "big-brain.sqlite";
export declare const CONFIG_VERSION = 1;
export type InitProjectOptions = {
    cwd: string;
    name: string;
    force?: boolean;
    now?: Date;
    dockerBuild?: () => Promise<void>;
};
export type InitProjectResult = {
    created: boolean;
    projectDir: string;
    configPath: string;
    databasePath: string;
};
export declare class AlreadyInitializedError extends Error {
    readonly projectDir: string;
    constructor(projectDir: string);
}
export declare function initProject(options: InitProjectOptions): Promise<InitProjectResult>;
