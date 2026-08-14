import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { initProject } from "./project-context.js";
import { run } from "./run.js";

const execFileAsync = promisify(execFile);

test("run() in head mode runs a Docker fake agent and writes to the current working tree", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
  await initProject({ cwd, name: "demo" });

  await run({
    cwd,
    name: "head-fake",
    prompt: "write a file",
    executionMode: "direct",
    agentCommand: "node -e 'const fs = require(\"fs\"); fs.writeFileSync(\"agent-output.txt\", \"ok\")'"
  } as Parameters<typeof run>[0] & { agentCommand: string });

  assert.equal(await readFile(path.join(cwd, "agent-output.txt"), "utf8"), "ok");
  assert.equal(await readFile(path.join(cwd, ".big-brain", "runs", "head-fake", "log.txt"), "utf8"), "");
  const resultJson = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "head-fake", "result.json"), "utf8"));
  assert.equal(resultJson.status, "completed");
  assert.deepEqual(resultJson.commits, []);
});

test("run() in branch mode runs a Docker fake agent inside an internal worktree", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
  await initGitRepo(cwd);
  await initProject({ cwd, name: "demo" });

  await run({
    cwd,
    name: "branch-fake",
    prompt: "write a file",
    branchStrategy: { type: "branch", branch: "agent/fake" },
    executionMode: "direct",
    agentCommand: "node -e 'const fs = require(\"fs\"); fs.writeFileSync(\"agent-output.txt\", \"ok\")'"
  });

  await assert.rejects(readFile(path.join(cwd, "agent-output.txt"), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(path.join(cwd, ".big-brain", "worktrees", "agent-fake", "agent-output.txt"), "utf8"), "ok");
  const resultJson = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "branch-fake", "result.json"), "utf8"));
  assert.deepEqual(resultJson.branchStrategy, { type: "branch", branch: "agent/fake" });
  assert.equal(resultJson.branch, "agent/fake");
  assert.equal(resultJson.worktreePath, path.join(".big-brain", "worktrees", "agent-fake"));
});

test("run() reuses an existing branch worktree", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
  await initGitRepo(cwd);
  await initProject({ cwd, name: "demo" });

  await run({
    cwd,
    name: "first-branch-run",
    prompt: "write a file",
    branchStrategy: { type: "branch", branch: "agent/fake" },
    executionMode: "direct",
    agentCommand: "node -e 'require(\"fs\").writeFileSync(\"first.txt\", \"ok\")'"
  });
  const worktreePath = path.join(cwd, ".big-brain", "worktrees", "agent-fake");
  const worktreeGitDir = (await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: worktreePath })).stdout.trim();

  await run({
    cwd,
    name: "second-branch-run",
    prompt: "write another file",
    branchStrategy: { type: "branch", branch: "agent/fake" },
    executionMode: "direct",
    agentCommand: "node -e 'require(\"fs\").writeFileSync(\"second.txt\", \"ok\")'"
  });

  assert.equal((await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: worktreePath })).stdout.trim(), worktreeGitDir);
  assert.equal(await readFile(path.join(worktreePath, "first.txt"), "utf8"), "ok");
  assert.equal(await readFile(path.join(worktreePath, "second.txt"), "utf8"), "ok");
});

async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await writeFile(path.join(cwd, "README.md"), "initial\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
}

test("run() kills the agent process immediately when the completion signal appears", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
  await initProject({ cwd, name: "demo" });
  const startedAt = Date.now();

  const result = await run({
    cwd,
    name: "complete-fast",
    prompt: "finish",
    executionMode: "direct",
    agentCommand: "node -e 'console.log(\"<promise>COMPLETE</promise>\"); setTimeout(() => {}, 10000)'"
  });

  assert.equal(result.status, "completed");
  assert.ok(Date.now() - startedAt < 2_000);
  assert.match(await readFile(path.join(cwd, ".big-brain", "runs", "complete-fast", "log.txt"), "utf8"), /<promise>COMPLETE<\/promise>/);
});

test("run() allocates a numeric suffix when the requested run name already exists", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
  await mkdir(path.join(cwd, ".big-brain", "runs", "demo"), { recursive: true });

  const result = await run({ cwd, name: "demo", prompt: "write a file" });

  assert.equal(result.id, "demo-2");
  assert.equal(await readFile(path.join(cwd, ".big-brain", "runs", "demo-2", "log.txt"), "utf8"), "");
  const resultJson = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "demo-2", "result.json"), "utf8"));
  assert.equal(resultJson.id, "demo-2");
  assert.equal(resultJson.status, "completed");
});

test("run() reports actionable Docker availability errors", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
  const originalPath = process.env.PATH;

  try {
    process.env.PATH = path.join(cwd, "missing-bin");
    const result = await run({
      cwd,
      name: "docker-unavailable",
      prompt: "write a file",
      agentCommand: "node -e ''"
    });

    assert.equal(result.status, "failed");
    assert.match(await readFile(path.join(cwd, ".big-brain", "runs", "docker-unavailable", "log.txt"), "utf8"), /Docker must be installed|Docker daemon|spawn docker ENOENT|permission denied/i);
  } finally {
    process.env.PATH = originalPath;
  }
});
