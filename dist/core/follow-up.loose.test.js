import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { run } from "./run.js";
const execFileAsync = promisify(execFile);
test("run() rejects a missing name before creating run artifacts", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-follow-up-"));
    await assert.rejects(run({ cwd, prompt: "write a file" }), /name/i);
    await assert.rejects(readFile(path.join(cwd, ".big-brain", "runs"), "utf8"), { code: "ENOENT" });
});
test("run() rejects a missing inline prompt before invoking Docker", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-follow-up-"));
    const dockerLogPath = path.join(cwd, "docker-argv.json");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.BB_FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)));
`);
    const originalPath = process.env.PATH;
    const originalDockerLog = process.env.BB_FAKE_DOCKER_LOG;
    try {
        process.env.PATH = env.PATH;
        process.env.BB_FAKE_DOCKER_LOG = dockerLogPath;
        await assert.rejects(run({ cwd, name: "missing-prompt", agentCommand: "node -e ''" }), /prompt/i);
        await assert.rejects(readFile(dockerLogPath, "utf8"), { code: "ENOENT" });
    }
    finally {
        process.env.PATH = originalPath;
        if (originalDockerLog === undefined) {
            delete process.env.BB_FAKE_DOCKER_LOG;
        }
        else {
            process.env.BB_FAKE_DOCKER_LOG = originalDockerLog;
        }
    }
});
test("bb run requires --name, --prompt, and --agent-command", async () => {
    for (const args of [
        ["run", "--agent-command", "node -e ''", "--prompt", "write a file"],
        ["run", "--name", "missing-prompt", "--agent-command", "node -e ''"],
        ["run", "--name", "missing-command", "--prompt", "write a file"]
    ]) {
        await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), ...args]), (error) => {
            assert.match(String(error.stderr), /required option/i);
            return true;
        });
    }
});
test("bb run passes the agent command to Docker via sh -lc", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-follow-up-"));
    const dockerLogPath = path.join(cwd, "docker-argv.json");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.BB_FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "docker-shell", "--agent-command", "node -e 'console.log(1)'", "--prompt", "write a file"], { cwd, env: { ...env, BB_FAKE_DOCKER_LOG: dockerLogPath } });
    const dockerArgs = JSON.parse(await readFile(dockerLogPath, "utf8"));
    assert.deepEqual(dockerArgs.slice(-3), ["sh", "-lc", "node -e 'console.log(1)'"]);
});
test("Docker Sandbox uses Docker's default network", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-follow-up-"));
    const dockerLogPath = path.join(cwd, "docker-argv.json");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.BB_FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "default-network", "--agent-command", "node -e ''", "--prompt", "write a file"], { cwd, env: { ...env, BB_FAKE_DOCKER_LOG: dockerLogPath } });
    const dockerArgs = JSON.parse(await readFile(dockerLogPath, "utf8"));
    assert.equal(dockerArgs.includes("--network"), false);
});
test("run artifacts record timestamps and a completed lifecycle status", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-follow-up-"));
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "metadata", "--agent-command", "node -e ''", "--prompt", "write a file"], { cwd, env });
    const result = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "metadata", "result.json"), "utf8"));
    assert.equal(result.status, "completed");
    assert.match(result.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.match(result.completedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});
test("log.txt contains agent stdout and stderr only", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-follow-up-"));
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
console.log("stdout from agent");
console.error("stderr from agent");
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "log-only", "--agent-command", "node -e ''", "--prompt", "secret prompt text"], { cwd, env });
    const log = await readFile(path.join(cwd, ".big-brain", "runs", "log-only", "log.txt"), "utf8");
    assert.match(log, /stdout from agent/);
    assert.match(log, /stderr from agent/);
    assert.doesNotMatch(log, /secret prompt text/);
    assert.doesNotMatch(log, /status|branchStrategy|events/);
});
test("README documents that opencode() requires an image with OpenCode installed", async () => {
    const readme = await readFile(path.join(process.cwd(), "README.md"), "utf8");
    assert.match(readme, /opencode\(\)/i);
    assert.match(readme, /Docker image[\s\S]*OpenCode installed/i);
});
async function fakeDockerEnv(cwd, script) {
    const binDir = path.join(cwd, "bin");
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), script, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    return { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
}
//# sourceMappingURL=follow-up.loose.test.js.map