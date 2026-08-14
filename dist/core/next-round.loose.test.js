import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
test("package root exports run and opencode", async () => {
    const root = (await import(pathToFileURL(path.join(process.cwd(), "dist", "index.js")).href));
    assert.equal(typeof root.run, "function");
    assert.equal(typeof root.opencode, "function");
    assert.deepEqual(root.opencode(), { type: "opencode" });
});
test("docker sandbox export describes the default Docker Sandbox", async () => {
    const sandbox = (await import(pathToFileURL(path.join(process.cwd(), "dist", "sandboxes", "docker.js")).href));
    assert.equal(typeof sandbox.docker, "function");
    assert.deepEqual(sandbox.docker(), {
        type: "docker",
        image: `big-brain:${path.basename(process.cwd())}`,
        installsOpenCode: false
    });
});
test("bb run executes the agent command through Docker with the repo mounted at /workspace", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-docker-run-"));
    const binDir = path.join(cwd, "bin");
    const dockerLogPath = path.join(cwd, "docker-argv.json");
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.BB_FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
`, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "docker-head",
        "--agent-command",
        "node -e ''",
        "--prompt",
        "write a file"
    ], { cwd, env: { ...process.env, BB_FAKE_DOCKER_LOG: dockerLogPath, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` } });
    const dockerArgs = JSON.parse(await readFile(dockerLogPath, "utf8"));
    assert.equal(dockerArgs[0], "run");
    assert.ok(dockerArgs.includes("--rm"));
    assert.ok(dockerArgs.includes("-i"));
    assert.ok(dockerArgs.includes(`${cwd}:/workspace`));
    assert.equal(dockerArgs[dockerArgs.indexOf("-w") + 1], "/workspace");
    assert.equal(dockerArgs[dockerArgs.indexOf("--user") + 1], "agent");
});
test("branch strategy creates a real git worktree from current HEAD", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-worktree-"));
    const binDir = path.join(cwd, "bin");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
    await writeFile(path.join(cwd, "README.md"), "initial\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
    const originalHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), `#!/usr/bin/env node
require("node:fs").writeFileSync("dirty.txt", "dirty");
process.stdin.resume();
`, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "branch-worktree",
        "--branch",
        "agent/fake",
        "--agent-command",
        "node -e ''",
        "--prompt",
        "write a file"
    ], { cwd, env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` } });
    const worktreePath = path.join(cwd, ".big-brain", "worktrees", "agent-fake");
    assert.equal((await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: worktreePath })).stdout.trim(), "true");
    assert.equal((await execFileAsync("git", ["branch", "--show-current"], { cwd: worktreePath })).stdout.trim(), "agent/fake");
    assert.equal((await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreePath })).stdout.trim(), originalHead);
});
test("successful clean branch runs remove the internal worktree", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-clean-worktree-"));
    const binDir = path.join(cwd, "bin");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
    await writeFile(path.join(cwd, "README.md"), "initial\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), `#!/usr/bin/env node
process.stdin.resume();
`, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "clean-branch",
        "--branch",
        "agent/clean",
        "--agent-command",
        "node -e ''",
        "--prompt",
        "write a file"
    ], { cwd, env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` } });
    const worktreePath = path.join(cwd, ".big-brain", "worktrees", "agent-clean");
    await assert.rejects(readFile(path.join(worktreePath, "README.md"), "utf8"), { code: "ENOENT" });
    const resultJson = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "clean-branch", "result.json"), "utf8"));
    assert.equal(resultJson.status, "completed");
    assert.ok(resultJson.events?.some((event) => event.type === "worktree.removed" && event.worktreePath === path.join(".big-brain", "worktrees", "agent-clean")));
});
test("successful dirty branch runs preserve the internal worktree and report it", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-dirty-worktree-"));
    const binDir = path.join(cwd, "bin");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
    await writeFile(path.join(cwd, "README.md"), "initial\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), `#!/usr/bin/env node
require("node:fs").writeFileSync("agent-output.txt", "ok");
process.stdin.resume();
`, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "dirty-branch",
        "--branch",
        "agent/dirty",
        "--agent-command",
        "node -e ''",
        "--prompt",
        "write a file"
    ], { cwd, env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` } });
    const worktreePath = path.join(cwd, ".big-brain", "worktrees", "agent-dirty");
    assert.equal(await readFile(path.join(worktreePath, "agent-output.txt"), "utf8"), "ok");
    const resultJson = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "dirty-branch", "result.json"), "utf8"));
    assert.equal(resultJson.status, "completed");
    assert.equal(resultJson.preservedWorktreePath, path.join(".big-brain", "worktrees", "agent-dirty"));
});
test("README documents first-slice usage and deferred features", async () => {
    const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
    assert.match(readme, /bb -- run[\s\S]*--name[\s\S]*--agent-command[\s\S]*--prompt/);
    assert.match(readme, /--branch[\s\S]*agent\/fake/);
    assert.match(readme, /OpenCode[\s\S]*deferred/i);
    assert.match(readme, /file artifacts[\s\S]*not SQLite/i);
});
//# sourceMappingURL=next-round.loose.test.js.map