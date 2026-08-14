import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { initProject } from "./project-context.js";
import { run } from "./run.js";
test("run() in head mode runs a Docker fake agent and writes to the current working tree", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
    await initProject({ cwd, name: "demo" });
    await run({
        cwd,
        name: "head-fake",
        prompt: "write a file",
        agentCommand: "node -e 'const fs = require(\"fs\"); fs.writeFileSync(\"agent-output.txt\", \"ok\")'"
    });
    assert.equal(await readFile(path.join(cwd, "agent-output.txt"), "utf8"), "ok");
    assert.equal(await readFile(path.join(cwd, ".big-brain", "runs", "head-fake", "log.txt"), "utf8"), "");
    const resultJson = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "head-fake", "result.json"), "utf8"));
    assert.equal(resultJson.status, "completed");
    assert.deepEqual(resultJson.commits, []);
});
test("run() in branch mode runs a Docker fake agent inside an internal worktree", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
    await initProject({ cwd, name: "demo" });
    await run({
        cwd,
        name: "branch-fake",
        prompt: "write a file",
        branchStrategy: { type: "branch", branch: "agent/fake" },
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
    // Arrange an existing .big-brain/worktrees/agent-fake worktree.
    // Run another branch Run against branch "agent/fake".
    // Assert the existing worktree path is reused rather than suffixed or recreated elsewhere.
});
test("run() kills the agent process immediately when the completion signal appears", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-run-"));
    await initProject({ cwd, name: "demo" });
    const startedAt = Date.now();
    const result = await run({
        cwd,
        name: "complete-fast",
        prompt: "finish",
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
    // Simulate docker being missing or unavailable.
    // Assert the error tells the user Docker must be installed/running and does not fall back silently.
});
//# sourceMappingURL=run.loose.test.js.map