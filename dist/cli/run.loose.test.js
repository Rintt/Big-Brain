import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", c => input += c);
process.stdin.on("end", () => require("fs").writeFileSync("prompt.txt", input));
`);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "stdin-check",
        "--agent-command",
        "node -e 'let input=\"\"; process.stdin.on(\"data\", c => input += c); process.stdin.on(\"end\", () => require(\"fs\").writeFileSync(\"prompt.txt\", input))'",
        "--prompt",
        "write a file"
    ], { cwd, env });
    assert.equal(await readFile(path.join(cwd, "prompt.txt"), "utf8"), "write a file");
});
test("bb run writes log.txt and result.json under the resolved run artifact directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await initProject({ cwd, name: "demo" });
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
console.log("agent output");
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "fake-test",
        "--agent-command",
        "node -e 'console.log(" + JSON.stringify("agent output") + ")'",
        "--prompt",
        "write a file"
    ], { cwd, env });
    const logPath = path.join(cwd, ".big-brain", "runs", "fake-test", "log.txt");
    const resultPath = path.join(cwd, ".big-brain", "runs", "fake-test", "result.json");
    const result = JSON.parse(await readFile(resultPath, "utf8"));
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
    await initGitRepo(cwd);
    await initProject({ cwd, name: "demo" });
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [
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
    ], { cwd, env });
    const resultPath = path.join(cwd, ".big-brain", "runs", "fake-branch", "result.json");
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.deepEqual(result.branchStrategy, { type: "branch", branch: "agent/fake" });
});
async function fakeDockerEnv(cwd, script) {
    const binDir = path.join(cwd, "bin");
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), script, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    return { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
}
async function initGitRepo(cwd) {
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
    await writeFile(path.join(cwd, "README.md"), "initial\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd });
}
test("bb run surfaces Docker installation/start instructions when Docker is unavailable", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await initProject({ cwd, name: "demo" });
    let error;
    try {
        await execFileAsync(process.execPath, [
            path.resolve("dist/cli/index.js"),
            "run",
            "--name",
            "docker-unavailable",
            "--agent-command",
            "docker run --rm big-brain:missing true",
            "--prompt",
            "write a file"
        ], { cwd, env: { ...process.env, PATH: path.join(cwd, "missing-bin") } });
    }
    catch (caught) {
        error = caught;
    }
    assert.ok(error instanceof Error);
    assert.match(String(error.stderr), /Docker must be installed and running/i);
});
test("bb run reports a missing Big Brain Docker image separately from Docker availability", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await initProject({ cwd, name: "demo" });
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
console.error("Unable to find image 'big-brain:missing' locally");
console.error("docker: Error response from daemon: pull access denied for big-brain, repository does not exist or may require 'docker login'");
process.exit(125);
`);
    await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "missing-image", "--agent-command", "node -e ''", "--prompt", "write a file"], { cwd, env }), (error) => {
        const stderr = String(error.stderr);
        assert.match(stderr, /Docker image big-brain:missing was not found/i);
        assert.doesNotMatch(stderr, /Docker must be installed and running/i);
        return true;
    });
});
test("bb run explains hash-like Docker image tags from Docker Desktop bind mounts", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await initProject({ cwd, name: "demo" });
    const configPath = path.join(cwd, ".big-brain", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const image = "big-brain:d9a73214bbc9a3689d19ced58d56d607daa0ab7ce9079025d6bbee7176bfd26b";
    await writeFile(configPath, `${JSON.stringify({ ...config, dockerImage: image }, null, 2)}\n`, "utf8");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
console.error("Unable to find image '${image}' locally");
console.error("docker: Error response from daemon: pull access denied for big-brain, repository does not exist or may require 'docker login'");
process.exit(125);
`);
    await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "hash-image", "--agent-command", "node -e ''", "--prompt", "write a file"], { cwd, env }), (error) => {
        const stderr = String(error.stderr);
        assert.match(stderr, /Docker Desktop.*bind-mount/i);
        assert.match(stderr, /real repo path/i);
        return true;
    });
});
test("bb run uses the Docker image recorded in project config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await initProject({ cwd, name: "demo" });
    const configPath = path.join(cwd, ".big-brain", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, `${JSON.stringify({ ...config, dockerImage: "big-brain:configured" }, null, 2)}\n`, "utf8");
    const dockerLogPath = path.join(cwd, "docker-argv.json");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.BB_FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "configured-image", "--agent-command", "node -e ''", "--prompt", "write a file"], { cwd, env: { ...env, BB_FAKE_DOCKER_LOG: dockerLogPath } });
    const dockerArgs = JSON.parse(await readFile(dockerLogPath, "utf8"));
    assert.equal(dockerArgs.includes("big-brain:configured"), true);
});
test("bb reset reinstalls a clean .big-brain using the existing project name", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await initProject({ cwd, name: "demo" });
    await mkdir(path.join(cwd, ".big-brain", "runs", "old-run"), { recursive: true });
    await writeFile(path.join(cwd, ".big-brain", "runs", "old-run", "log.txt"), "old", "utf8");
    await writeFile(path.join(cwd, "outside.txt"), "keep", "utf8");
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "reset"], { cwd });
    const config = JSON.parse(await readFile(path.join(cwd, ".big-brain", "config.json"), "utf8"));
    assert.equal(config.projectName, "demo");
    assert.equal(config.dockerImage, `big-brain:${path.basename(cwd)}`);
    assert.equal(await readFile(path.join(cwd, "outside.txt"), "utf8"), "keep");
    await assert.rejects(readFile(path.join(cwd, ".big-brain", "runs", "old-run", "log.txt"), "utf8"), { code: "ENOENT" });
});
test("bb reset requires --name when no existing project config exists", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-cli-"));
    await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "reset"], { cwd }), (error) => {
        assert.match(String(error.stderr), /requires --name/i);
        return true;
    });
    await assert.rejects(readFile(path.join(cwd, ".big-brain", "config.json"), "utf8"), { code: "ENOENT" });
});
//# sourceMappingURL=run.loose.test.js.map