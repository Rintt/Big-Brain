  import { execFile, spawn } from "node:child_process";
  import { mkdir, readFile, writeFile } from "node:fs/promises";
  import path from "node:path";
  import { promisify } from "node:util";
  import { BIG_BRAIN_DIR } from "./project-context.js";

  const execFileAsync = promisify(execFile);

  export type BranchStrategy = { type: "head" } | { type: "branch"; branch: string };

  export type RunOptions = {
    cwd: string;
    name: string;
    prompt: string;
     branchStrategy?: BranchStrategy;
     agentCommand?: string;
     environmentVariables?: string[];
     executionMode?: "docker" | "direct";
     completionSignal?: string;
  };

  export type RunResult = {
    id: string;
    status: "completed" | "failed";
    logPath: string;
    resultPath: string;
  };

  export async function run(options: RunOptions): Promise<RunResult> {
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
     let status: "completed" | "failed" = "completed";
     let exitCode = 0;
     let log = "";
     let finalOutput: string | null = null;
    const events: Array<{ type: string; worktreePath?: string }> = [];
    let preservedWorktreePath: string | null = null;
    const startedAt = new Date().toISOString();

    await mkdir(runDir, { recursive: true });
    if (branchStrategy.type === "branch") {
      await ensureBranchWorktree(options.cwd, branchStrategy.branch, executionCwd);
    } else {
      await mkdir(executionCwd, { recursive: true });
    }

     if (options.agentCommand) {
       try {
         const command = options.executionMode === "direct" ? directCommand(options.agentCommand) : dockerCommand(executionCwd, options.agentCommand, await dockerImage(options.cwd), options.environmentVariables ?? []);
         const output = await runCommand(executionCwd, command.file, command.args, options.prompt, options.completionSignal ?? "<promise>COMPLETE</promise>");
         log = output.log;
         exitCode = output.exitCode;
         finalOutput = extractFinalOutput(log);
       } catch (error) {
         const failed = error as Error & { log?: string; exitCode?: number };
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
      } else {
        preservedWorktreePath = path.join(BIG_BRAIN_DIR, "worktrees", sanitizeBranch(branchStrategy.branch));
      }
    }

    await writeFile(logPath, log, "utf8");
    const completedAt = new Date().toISOString();
    await writeFile(
      resultPath,
      `${JSON.stringify(
        {
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
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    return { id, status, logPath, resultPath };
  }

  async function isWorktreeClean(worktreePath: string): Promise<boolean> {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath });
    return stdout.trim() === "";
  }

  function sanitizeBranch(branch: string): string {
    return branch.replace(/[^a-zA-Z0-9]/g, "-");
  }

  async function ensureBranchWorktree(cwd: string, branch: string, worktreePath: string): Promise<void> {
    if (await exists(worktreePath)) {
      return;
    }

    await mkdir(path.dirname(worktreePath), { recursive: true });
    await execFileAsync("git", ["worktree", "add", "-B", branch, worktreePath, "HEAD"], { cwd });
  }

  async function runCommand(cwd: string, command: string, args: string[], input: string, completionSignal: string): Promise<{ log: string; exitCode: number }> {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      let log = "";
      let completedBySignal = false;

      const appendLog = (chunk: string) => {
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
      child.stdout.on("data", (chunk: string) => {
        appendLog(chunk);
      });
      child.stderr.on("data", (chunk: string) => {
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

  function directCommand(command: string): { file: string; args: string[] } {
    return { file: "sh", args: ["-lc", command] };
  }

   function dockerCommand(workspacePath: string, command: string, image: string, environmentVariables: string[]): { file: string; args: string[] } {
     const environmentArgs = environmentVariables.flatMap((name) => ["-e", name]);
     return {
       file: "docker",
       args: ["run", "--rm", "-i", ...environmentArgs, "-v", `${workspacePath}:/workspace`, "-w", "/workspace", "--user", "agent", image, "sh", "-lc", command]
     };
   }

   function extractFinalOutput(log: string): string | null {
     let finalOutput: string | null = null;

     for (const line of log.split(/\r?\n/)) {
       const trimmed = line.trim();
       if (!trimmed.startsWith("{")) {
         continue;
       }

       try {
         const event = JSON.parse(trimmed) as unknown;
         const candidate = assistantTextFromJson(event);
         if (candidate !== null && candidate.trim().length > 0) {
           finalOutput = candidate.trim();
         }
       } catch {
         // OpenCode JSON events are best-effort; raw log remains canonical.
       }
     }

     return finalOutput;
   }

   function assistantTextFromJson(value: unknown): string | null {
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

   function textContent(value: unknown): string | null {
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
       }).filter((part): part is string => part !== null && part.length > 0);
       return parts.length > 0 ? parts.join("") : null;
     }

     if (isRecord(value)) {
       return textContent(value.text) ?? textContent(value.content);
     }

     return null;
   }

   function isRecord(value: unknown): value is Record<string, unknown> {
     return typeof value === "object" && value !== null && !Array.isArray(value);
   }

  async function dockerImage(cwd: string): Promise<string> {
    try {
      const config = JSON.parse(await readFile(path.join(cwd, BIG_BRAIN_DIR, "config.json"), "utf8")) as { dockerImage?: unknown };
      if (typeof config.dockerImage === "string" && config.dockerImage.length > 0) {
        return config.dockerImage;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return `big-brain:${path.basename(cwd)}`;
  }

  function withActionableDockerMessage(log: string): string {
    const missingImage = missingDockerImage(log);
    if (missingImage !== null) {
      return `${log}${log.endsWith("\n") || log.length === 0 ? "" : "\n"}${missingDockerImageMessage(missingImage)}\n`;
    }

    if (/docker: not found|spawn docker ENOENT|cannot connect to the docker daemon|is the docker daemon running|permission denied while trying to connect to the docker api/i.test(log)) {
      return `${log}${log.endsWith("\n") || log.length === 0 ? "" : "\n"}Docker must be installed and running to use the Docker Sandbox. If the Big Brain Docker image is missing, run bb init or build the configured image.\n`;
    }

    return log;
  }

  function missingDockerImageMessage(image: string): string {
    const baseMessage = `Docker image ${image} was not found.`;
    if (/^big-brain:[a-f0-9]{64}$/i.test(image)) {
      return `${baseMessage} This looks like a tag created from Docker Desktop's bind-mount path; run Big Brain from the real repo path and set dockerImage in .big-brain/config.json to the image you built.`;
    }

    return `${baseMessage} Run bb init or build .big-brain/sandbox/Dockerfile with that tag.`;
  }

  function missingDockerImage(log: string): string | null {
    const missingLocalImage = log.match(/Unable to find image '([^']+)' locally/i);
    if (missingLocalImage !== null) {
      return missingLocalImage[1];
    }

    if (/pull access denied for big-brain|repository does not exist/i.test(log)) {
      return "big-brain:<repo-dir-name>";
    }

    return null;
  }

  function withActionableAgentMessage(log: string): string {
    if (/opencode: not found|opencode.*not found/i.test(log)) {
      return `${log}${log.endsWith("\n") || log.length === 0 ? "" : "\n"}OpenCode is missing from the Docker image. Build or choose a Docker image with OpenCode installed.\n`;
    }

    return log;
  }

  async function allocateRunId(cwd: string, requestedName: string): Promise<string> {
    if (!(await exists(path.join(cwd, BIG_BRAIN_DIR, "runs", requestedName)))) {
      return requestedName;
    }

    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${requestedName}-${suffix}`;
      if (!(await exists(path.join(cwd, BIG_BRAIN_DIR, "runs", candidate)))) {
        return candidate;
      }
    }
  }

  async function exists(targetPath: string): Promise<boolean> {
    try {
      await readFile(targetPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EISDIR") {
        return true;
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }
