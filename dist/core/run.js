import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { BIG_BRAIN_DIR } from "./project-context.js";
const execFileAsync = promisify(execFile);
export async function run(options) {
    if (!options.name) {
        throw new Error("run requires a name.");
    }
    if (!options.prompt) {
        throw new Error("run requires an inline prompt.");
    }
    const id = await allocateRunId(options.cwd, options.name);
    const runDir = path.join(options.cwd, BIG_BRAIN_DIR, "runs", id);
    const logPath = path.join(runDir, "log.txt");
    const resultPath = path.join(runDir, "result.json");
    const branchStrategy = options.branchStrategy ?? { type: "head" };
    const executionCwd = branchStrategy.type === "branch" ? path.join(options.cwd, BIG_BRAIN_DIR, "worktrees", sanitizeBranch(branchStrategy.branch)) : options.cwd;
    const worktreePath = branchStrategy.type === "branch" ? path.join(BIG_BRAIN_DIR, "worktrees", sanitizeBranch(branchStrategy.branch)) : null;
    let status = "completed";
    let exitCode = 0;
    let log = "";
    let finalOutput = null;
    const events = [];
    let preservedWorktreePath = null;
    const startedAt = new Date().toISOString();
    await mkdir(runDir, { recursive: true });
    if (branchStrategy.type === "branch") {
        await ensureBranchWorktree(options.cwd, branchStrategy.branch, executionCwd);
    }
    else {
        await mkdir(executionCwd, { recursive: true });
    }
    if (options.agentCommand) {
        try {
            const command = options.executionMode === "direct" ? directCommand(options.agentCommand) : dockerCommand(executionCwd, options.agentCommand, await dockerImage(options.cwd), options.environmentVariables ?? []);
            const output = await runCommand(executionCwd, command.file, command.args, options.prompt, options.completionSignal ?? "<promise>COMPLETE</promise>");
            log = output.log;
            exitCode = output.exitCode;
            finalOutput = extractFinalOutput(log);
        }
        catch (error) {
            const failed = error;
            status = "failed";
            exitCode = failed.exitCode ?? 1;
            log = withActionableAgentMessage(withActionableDockerMessage(failed.log ?? ""));
            finalOutput = extractFinalOutput(log);
        }
    }
    if (status === "completed" && branchStrategy.type === "branch") {
        if (await isWorktreeClean(executionCwd)) {
            await execFileAsync("git", ["worktree", "remove", executionCwd], { cwd: options.cwd });
            events.push({ type: "worktree.removed", worktreePath: path.join(BIG_BRAIN_DIR, "worktrees", sanitizeBranch(branchStrategy.branch)) });
        }
        else {
            preservedWorktreePath = path.join(BIG_BRAIN_DIR, "worktrees", sanitizeBranch(branchStrategy.branch));
        }
    }
    await writeFile(logPath, log, "utf8");
    const completedAt = new Date().toISOString();
    await writeFile(resultPath, `${JSON.stringify({
        id,
        status,
        startedAt,
        completedAt,
        exitCode,
        branchStrategy,
        branch: branchStrategy.type === "branch" ? branchStrategy.branch : null,
        worktreePath,
        preservedWorktreePath,
        logPath: path.join(BIG_BRAIN_DIR, "runs", id, "log.txt"),
        finalOutput,
        commits: [],
        events
    }, null, 2)}\n`, "utf8");
    return { id, status, logPath, resultPath };
}
async function isWorktreeClean(worktreePath) {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath });
    return stdout.trim() === "";
}
function sanitizeBranch(branch) {
    return branch.replace(/[^a-zA-Z0-9]/g, "-");
}
async function ensureBranchWorktree(cwd, branch, worktreePath) {
    if (await exists(worktreePath)) {
        return;
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await execFileAsync("git", ["worktree", "add", "-B", branch, worktreePath, "HEAD"], { cwd });
}
async function runCommand(cwd, command, args, input, completionSignal) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
        let log = "";
        let completedBySignal = false;
        const appendLog = (chunk) => {
            log += chunk;
            if (!completedBySignal && log.includes(completionSignal)) {
                completedBySignal = true;
                if (child.pid !== undefined) {
                    process.kill(-child.pid);
                }
            }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            appendLog(chunk);
        });
        child.stderr.on("data", (chunk) => {
            appendLog(chunk);
        });
        child.on("error", (error) => {
            reject(Object.assign(error, { log: log || error.message, exitCode: 1 }));
        });
        child.on("close", (code) => {
            if (completedBySignal) {
                resolve({ log, exitCode: 0 });
                return;
            }
            if (code === 0) {
                resolve({ log, exitCode: 0 });
                return;
            }
            reject(Object.assign(new Error(`Agent command failed with exit code ${code ?? 1}.`), { log, exitCode: code ?? 1 }));
        });
        child.stdin.end(input);
    });
}
function directCommand(command) {
    return { file: "sh", args: ["-lc", command] };
}
function dockerCommand(workspacePath, command, image, environmentVariables) {
    const environmentArgs = environmentVariables.flatMap((name) => ["-e", name]);
    return {
        file: "docker",
        args: ["run", "--rm", "-i", ...environmentArgs, "-v", `${workspacePath}:/workspace`, "-w", "/workspace", "--user", "agent", image, "sh", "-lc", command]
    };
}
function extractFinalOutput(log) {
    let finalOutput = null;
    for (const line of log.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
            continue;
        }
        try {
            const event = JSON.parse(trimmed);
            const candidate = assistantTextFromJson(event);
            if (candidate !== null && candidate.trim().length > 0) {
                finalOutput = candidate.trim();
            }
        }
        catch {
            // OpenCode JSON events are best-effort; raw log remains canonical.
        }
    }
    return finalOutput;
}
function assistantTextFromJson(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (value.role === "assistant") {
        return textContent(value.content) ?? textContent(value.text) ?? textContent(value.message);
    }
    if (isRecord(value.message) && value.message.role === "assistant") {
        return textContent(value.message.content) ?? textContent(value.message.text);
    }
    if (typeof value.type === "string" && /assistant|message|response|text/i.test(value.type)) {
        return textContent(value.content) ?? textContent(value.text) ?? textContent(value.output);
    }
    return null;
}
function textContent(value) {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        const parts = value.map((part) => {
            if (typeof part === "string") {
                return part;
            }
            if (isRecord(part)) {
                return textContent(part.text) ?? textContent(part.content);
            }
            return null;
        }).filter((part) => part !== null && part.length > 0);
        return parts.length > 0 ? parts.join("") : null;
    }
    if (isRecord(value)) {
        return textContent(value.text) ?? textContent(value.content);
    }
    return null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function dockerImage(cwd) {
    try {
        const config = JSON.parse(await readFile(path.join(cwd, BIG_BRAIN_DIR, "config.json"), "utf8"));
        if (typeof config.dockerImage === "string" && config.dockerImage.length > 0) {
            return config.dockerImage;
        }
    }
    catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
    return `big-brain:${path.basename(cwd)}`;
}
function withActionableDockerMessage(log) {
    const missingImage = missingDockerImage(log);
    if (missingImage !== null) {
        return `${log}${log.endsWith("\n") || log.length === 0 ? "" : "\n"}${missingDockerImageMessage(missingImage)}\n`;
    }
    if (/docker: not found|spawn docker ENOENT|cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect to the docker api/i.test(log)) {
        return `${log}${log.endsWith("\n") || log.length === 0 ? "" : "\n"}Docker must be installed and running to use the Docker Sandbox. If the Big Brain Docker image is missing, run bb init or build the configured image.\n`;
    }
    return log;
}
function missingDockerImageMessage(image) {
    const baseMessage = `Docker image ${image} was not found.`;
    if (/^big-brain:[a-f0-9]{64}$/i.test(image)) {
        return `${baseMessage} This looks like a tag created from Docker Desktop's bind-mount path; run Big Brain from the real repo path and set dockerImage in .big-brain/config.json to the image you built.`;
    }
    return `${baseMessage} Run bb init or build .big-brain/sandbox/Dockerfile with that tag.`;
}
function missingDockerImage(log) {
    const missingLocalImage = log.match(/Unable to find image '([^']+)' locally/i);
    if (missingLocalImage !== null) {
        return missingLocalImage[1];
    }
    if (/pull access denied for big-brain|repository does not exist/i.test(log)) {
        return "big-brain:<repo-dir-name>";
    }
    return null;
}
function withActionableAgentMessage(log) {
    if (/opencode: not found|opencode.*not found/i.test(log)) {
        return `${log}${log.endsWith("\n") || log.length === 0 ? "" : "\n"}OpenCode is missing from the Docker image. Build or choose a Docker image with OpenCode installed.\n`;
    }
    return log;
}
async function allocateRunId(cwd, requestedName) {
    if (!(await exists(path.join(cwd, BIG_BRAIN_DIR, "runs", requestedName)))) {
        return requestedName;
    }
    for (let suffix = 2;; suffix += 1) {
        const candidate = `${requestedName}-${suffix}`;
        if (!(await exists(path.join(cwd, BIG_BRAIN_DIR, "runs", candidate)))) {
            return candidate;
        }
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
//# sourceMappingURL=run.js.map