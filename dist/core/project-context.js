import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase } from "../db/init.js";
export const BIG_BRAIN_DIR = ".big-brain";
export const CONFIG_FILE = "config.json";
export const DB_FILE = "big-brain.sqlite";
export const CONFIG_VERSION = 1;
const DEFAULT_DOCKERFILE = `FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@1.18.18

RUN if getent group 1000 >/dev/null; then groupmod --new-name agent "$(getent group 1000 | cut -d: -f1)"; else groupadd --gid 1000 agent; fi \
  && if id -u 1000 >/dev/null 2>&1; then usermod --login agent --home /home/agent --move-home --shell /bin/sh "$(getent passwd 1000 | cut -d: -f1)"; else useradd --uid 1000 --gid 1000 --create-home --shell /bin/sh agent; fi

WORKDIR /workspace
USER agent
`;
export class AlreadyInitializedError extends Error {
    projectDir;
    constructor(projectDir) {
        super(`Project is already initialized at ${projectDir}. Re-run with --force to regenerate .big-brain.`);
        this.projectDir = projectDir;
        this.name = "AlreadyInitializedError";
    }
}
export async function initProject(options) {
    assertSupportedWorkspacePath(options.cwd);
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
    await mkdir(path.join(projectDir, "sandbox"), { recursive: true });
    const packageVersion = await readPackageVersion();
    const createdAt = (options.now ?? new Date()).toISOString();
    const config = {
        projectName: options.name,
        configVersion: CONFIG_VERSION,
        bigBrainVersion: packageVersion,
        createdAt,
        defaultModel: "gpt-5.5",
        dockerImage: `big-brain:${path.basename(options.cwd)}`,
        paths: {
            database: `${BIG_BRAIN_DIR}/${DB_FILE}`,
            runs: `${BIG_BRAIN_DIR}/runs`,
            artifacts: `${BIG_BRAIN_DIR}/artifacts`,
            docs: `${BIG_BRAIN_DIR}/docs`
        }
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await writeFile(path.join(projectDir, "sandbox", "Dockerfile"), DEFAULT_DOCKERFILE, "utf8");
    initDatabase({ databasePath, projectName: options.name, createdAt });
    if (options.dockerBuild) {
        try {
            await options.dockerBuild({ image: config.dockerImage, context: path.join(projectDir, "sandbox") });
        }
        catch (error) {
            throw new Error(`Docker build failed. Install Docker, start Docker, then run docker build for ${path.join(projectDir, "sandbox")}.`, { cause: error });
        }
    }
    return { created: true, projectDir, configPath, databasePath };
}
function assertSupportedWorkspacePath(cwd) {
    if (path.normalize(cwd).startsWith("/mnt/wsl/docker-desktop-bind-mounts/")) {
        throw new Error("Big Brain must be initialized from the real repo path, not Docker Desktop's bind-mount path. Use the /mnt/c/... repo path instead.");
    }
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