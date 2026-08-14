import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { initProject } from "../core/project-context.js";

const execFileAsync = promisify(execFile);

test("bb run --agent-command passes the inline prompt via stdin", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
  await initProject({ cwd, name: "demo" });

  await execFileAsync(
    process.execPath,
    [
      path.resolve("dist/cli/index.js"),
      "run",
      "--name",
      "stdin-check",
      "--agent-command",
      "node -e 'let input=\"\"; process.stdin.on(\"data\", c => input += c); process.stdin.on(\"end\", () => require(\"fs\").writeFileSync(\"prompt.txt\", input))'",
      "--prompt",
      "write a file"
    ],
    { cwd }
  );

  assert.equal(await readFile(path.join(cwd, "prompt.txt"), "utf8"), "write a file");
});

test("bb run writes log.txt and result.json under the resolved run artifact directory", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
  await initProject({ cwd, name: "demo" });

  await execFileAsync(
    process.execPath,
    [
      path.resolve("dist/cli/index.js"),
      "run",
      "--name",
      "fake-test",
      "--agent-command",
      "node -e 'console.log(" + JSON.stringify("agent output") + ")'",
      "--prompt",
      "write a file"
    ],
    { cwd }
  );

  const logPath = path.join(cwd, ".big-brain", "runs", "fake-test", "log.txt");
  const resultPath = path.join(cwd, ".big-brain", "runs", "fake-test", "result.json");
  const result = JSON.parse(await readFile(resultPath, "utf8")) as {
    id?: string;
    status?: string;
    exitCode?: number;
    branchStrategy?: unknown;
    branch?: string | null;
    worktreePath?: string | null;
    logPath?: string;
    commits?: unknown[];
    events?: unknown[];
  };

  assert.equal(await readFile(logPath, "utf8"), "agent output\n");
  assert.equal(result.id, "fake-test");
  assert.equal(result.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.branchStrategy, { type: "head" });
  assert.equal(result.branch, null);
  assert.equal(result.worktreePath, null);
  assert.equal(result.logPath, path.join(".big-brain", "runs", "fake-test", "log.txt"));
  assert.deepEqual(result.commits, []);
  assert.deepEqual(result.events, []);
});

test("bb run --branch uses branch strategy instead of head strategy", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
  await initProject({ cwd, name: "demo" });

  await execFileAsync(
    process.execPath,
    [
      path.resolve("dist/cli/index.js"),
      "run",
      "--name",
      "fake-branch",
      "--branch",
      "agent/fake",
      "--agent-command",
      "node -e ''",
      "--prompt",
      "write a file"
    ],
    { cwd }
  );

  const resultPath = path.join(cwd, ".big-brain", "runs", "fake-branch", "result.json");
  const result = JSON.parse(await readFile(resultPath, "utf8")) as { branchStrategy?: unknown };

  assert.deepEqual(result.branchStrategy, { type: "branch", branch: "agent/fake" });
});

test("bb run surfaces Docker installation/start instructions when Docker is unavailable", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
  await initProject({ cwd, name: "demo" });
  let error: unknown;

  try {
    await execFileAsync(
      process.execPath,
      [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "docker-unavailable",
        "--agent-command",
        "docker run --rm big-brain:missing true",
        "--prompt",
        "write a file"
      ],
      { cwd, env: { ...process.env, PATH: "/bin" } }
    );
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof Error);
  assert.match(String((error as { stderr?: string }).stderr), /Docker must be installed and running/i);
});
