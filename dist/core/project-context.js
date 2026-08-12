import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase } from "../db/init.js";
export const BIG_BRAIN_DIR = ".big-brain";
export const CONFIG_FILE = "config.json";
export const DB_FILE = "big-brain.sqlite";
export const CONFIG_VERSION = 1;
export class AlreadyInitializedError extends Error {
    projectDir;
    constructor(projectDir) {
        super(`Project is already initialized at ${projectDir}. Re-run with --force to regenerate .big-brain.`);
        this.projectDir = projectDir;
        this.name = "AlreadyInitializedError";
    }
}
export async function initProject(options) {
    const projectDir = path.join(options.cwd, BIG_BRAIN_DIR);
    const configPath = path.join(projectDir, CONFIG_FILE);
    const databasePath = path.join(projectDir, DB_FILE);
    if (await exists(projectDir)) {
        if (!options.force) {
            throw new AlreadyInitializedError(projectDir);
        }
        await rm(projectDir, { recursive: true, force: true });
    }
    await mkdir(path.join(projectDir, "runs"), { recursive: true });
    await mkdir(path.join(projectDir, "artifacts"), { recursive: true });
    await mkdir(path.join(projectDir, "docs"), { recursive: true });
    const packageVersion = await readPackageVersion();
    const createdAt = (options.now ?? new Date()).toISOString();
    const config = {
        projectName: options.name,
        configVersion: CONFIG_VERSION,
        bigBrainVersion: packageVersion,
        createdAt,
        defaultModel: "gpt-5.5",
        paths: {
            database: `${BIG_BRAIN_DIR}/${DB_FILE}`,
            runs: `${BIG_BRAIN_DIR}/runs`,
            artifacts: `${BIG_BRAIN_DIR}/artifacts`,
            docs: `${BIG_BRAIN_DIR}/docs`
        }
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    initDatabase({ databasePath, projectName: options.name, createdAt });
    return { created: true, projectDir, configPath, databasePath };
}
async function exists(targetPath) {
    try {
        await readFile(targetPath);
        return true;
    }
    catch (error) {
        if (error.code === "EISDIR") {
            return true;
        }
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
async function readPackageVersion() {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return packageJson.version ?? "0.0.0";
}
//# sourceMappingURL=project-context.js.map