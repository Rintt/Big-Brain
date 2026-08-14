import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BIG_BRAIN_DIR } from "./project-context.js";

export type BranchStrategy = { type: "head" } | { type: "branch"; branch: string };

export type RunOptions = {
  cwd: string;
  name: string;
  prompt: string;
  branchStrategy?: BranchStrategy;
  agentCommand?: string;
  completionSignal?: string;
};

export type RunResult = {
  id: string;
  status: "completed" | "failed";
  logPath: string;
  resultPath: string;
};

export async function run(options: RunOptions): Promise<RunResult> {
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

  await mkdir(runDir, { recursive: true });
  await mkdir(executionCwd, { recursive: true });

  if (options.agentCommand) {
    try {
      const output = await runCommand(executionCwd, options.agentCommand, options.prompt, options.completionSignal ?? "<promise>COMPLETE</promise>");
      log = output.log;
      exitCode = output.exitCode;
    } catch (error) {
      const failed = error as Error & { log?: string; exitCode?: number };
      status = "failed";
      exitCode = failed.exitCode ?? 1;
      log = failed.log ?? "";
    }
  }

  await writeFile(logPath, log, "utf8");
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        id,
        status,
        exitCode,
        branchStrategy,
        branch: branchStrategy.type === "branch" ? branchStrategy.branch : null,
        worktreePath,
        logPath: path.join(BIG_BRAIN_DIR, "runs", id, "log.txt"),
        commits: [],
        events: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { id, status, logPath, resultPath };
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9]/g, "-");
}

async function runCommand(cwd: string, command: string, input: string, completionSignal: string): Promise<{ log: string; exitCode: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
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
      reject(Object.assign(error, { log, exitCode: 1 }));
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
