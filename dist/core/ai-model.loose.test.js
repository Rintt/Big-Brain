import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { opencode } from "../index.js";
const execFileAsync = promisify(execFile);
test("opencode() describes the OpenCode Agent Provider command", () => {
    assert.deepEqual(opencode(), {
        type: "opencode",
        command: "opencode run --format json --model openai/gpt-5.5"
    });
});
test("bb run --agent opencode invokes OpenCode through Docker via sh -lc", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    const dockerLogPath = path.join(cwd, "docker-argv.json");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.BB_FAKE_DOCKER_LOG, JSON.stringify(process.argv.slice(2)));
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "opencode-run", "--agent", "opencode", "--prompt", "write a file"], { cwd, env: { ...env, BB_FAKE_DOCKER_LOG: dockerLogPath, OPENAI_API_KEY: "test-key" } });
    const dockerArgs = JSON.parse(await readFile(dockerLogPath, "utf8"));
    assert.equal(dockerArgs.includes("-e"), true);
    assert.equal(dockerArgs.includes("OPENAI_API_KEY"), true);
    assert.deepEqual(dockerArgs.slice(-3), ["sh", "-lc", "opencode run --format json --model openai/gpt-5.5"]);
});
test("bb run --agent opencode passes the prompt to OpenCode via stdin", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    const promptLogPath = path.join(cwd, "prompt.txt");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => require("node:fs").writeFileSync(process.env.BB_FAKE_PROMPT_LOG, input));
`);
    await execFileAsync(process.execPath, [
        path.resolve("dist/cli/index.js"),
        "run",
        "--name",
        "opencode-stdin",
        "--agent",
        "opencode",
        "--prompt",
        "write a poem about pickles"
    ], { cwd, env: { ...env, BB_FAKE_PROMPT_LOG: promptLogPath, OPENAI_API_KEY: "test-key" } });
    assert.equal(await readFile(promptLogPath, "utf8"), "write a poem about pickles");
});
test("bb run --agent opencode requires OPENAI_API_KEY before creating artifacts", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "missing-key", "--agent", "opencode", "--prompt", "write a file"], {
        cwd,
        env
    }), (error) => {
        assert.match(String(error.stderr), /OPENAI_API_KEY is required/i);
        return true;
    });
    await assert.rejects(readFile(path.join(cwd, ".big-brain", "runs"), "utf8"), { code: "ENOENT" });
});
test("bb run --agent opencode reads OPENAI_API_KEY from openapi.pem", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    const apiKeyLogPath = path.join(cwd, "api-key.txt");
    await writeFile(path.join(cwd, "openapi.pem"), " file-key \n", "utf8");
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.BB_FAKE_API_KEY_LOG, process.env.OPENAI_API_KEY || "");
process.stdin.resume();
`);
    delete env.OPENAI_API_KEY;
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "file-key", "--agent", "opencode", "--prompt", "write a poem"], { cwd, env: { ...env, BB_FAKE_API_KEY_LOG: apiKeyLogPath } });
    assert.equal(await readFile(apiKeyLogPath, "utf8"), "file-key");
});
test("bb run stores best-effort finalOutput from OpenCode JSON events", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
console.log(JSON.stringify({ type: "message", role: "assistant", content: "pickle lines rhyme fine" }));
process.stdin.resume();
`);
    await execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "final-output", "--agent", "opencode", "--prompt", "write a poem"], { cwd, env: { ...env, OPENAI_API_KEY: "test-key" } });
    const result = JSON.parse(await readFile(path.join(cwd, ".big-brain", "runs", "final-output", "result.json"), "utf8"));
    assert.equal(result.finalOutput, "pickle lines rhyme fine");
});
test("bb run requires exactly one of --agent or --agent-command", async () => {
    for (const args of [
        ["run", "--name", "missing-agent", "--prompt", "write a file"],
        ["run", "--name", "too-many-agents", "--agent", "opencode", "--agent-command", "node -e ''", "--prompt", "write a file"]
    ]) {
        await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), ...args]), (error) => {
            assert.match(String(error.stderr), /exactly one of --agent or --agent-command/i);
            return true;
        });
    }
});
test("bb run rejects unsupported agent values before creating run artifacts", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "bad-agent", "--agent", "claude", "--prompt", "write a file"], { cwd }), (error) => {
        assert.match(String(error.stderr), /unsupported agent/i);
        return true;
    });
    await assert.rejects(readFile(path.join(cwd, ".big-brain", "runs"), "utf8"), { code: "ENOENT" });
});
test("bb run reports an actionable error when OpenCode is missing from the Docker image", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-ai-model-"));
    const env = await fakeDockerEnv(cwd, `#!/usr/bin/env node
console.error("sh: 1: opencode: not found");
process.exit(127);
`);
    await assert.rejects(execFileAsync(process.execPath, [path.resolve("dist/cli/index.js"), "run", "--name", "missing-opencode", "--agent", "opencode", "--prompt", "write a file"], {
        cwd,
        env: { ...env, OPENAI_API_KEY: "test-key" }
    }), (error) => {
        assert.match(String(error.stderr), /OpenCode.*Docker image.*installed/i);
        return true;
    });
});
async function fakeDockerEnv(cwd, script) {
    const binDir = path.join(cwd, "bin");
    await mkdir(binDir);
    await writeFile(path.join(binDir, "docker"), script, "utf8");
    await chmod(path.join(binDir, "docker"), 0o755);
    return { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` };
}
//# sourceMappingURL=ai-model.loose.test.js.map