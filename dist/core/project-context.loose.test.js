import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { initProject } from "./project-context.js";
test("initProject scaffolds the Docker Sandbox Dockerfile", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-init-"));
    await initProject({ cwd, name: "demo" });
    const dockerfile = await readFile(path.join(cwd, ".big-brain", "sandbox", "Dockerfile"), "utf8");
    assert.match(dockerfile, /^FROM node:22-bookworm-slim$/m);
    assert.match(dockerfile, /apt-get update/);
    assert.match(dockerfile, /apt-get install[^\n]*git/);
    assert.match(dockerfile, /groupadd[^\n]*--gid 1000[^\n]*agent/);
    assert.match(dockerfile, /useradd[^\n]*--uid 1000[^\n]*--gid 1000[^\n]*agent/);
    assert.match(dockerfile, /^USER agent$/m);
    assert.doesNotMatch(dockerfile.toLowerCase(), /opencode/);
});
test("initProject attempts to build big-brain:<repo-dir-name>", async () => {
    // Run initProject with Docker command execution observable.
    // Assert it attempts to build image name big-brain:<repo-dir-name>.
});
test("initProject keeps .big-brain files when Docker build fails", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-init-"));
    let error;
    try {
        await initProject({
            cwd,
            name: "demo",
            dockerBuild: async () => {
                throw new Error("docker is unavailable");
            }
        });
    }
    catch (caught) {
        error = caught;
    }
    assert.equal(await readFile(path.join(cwd, ".big-brain", "config.json"), "utf8").then(() => true), true);
    assert.equal(await readFile(path.join(cwd, ".big-brain", "sandbox", "Dockerfile"), "utf8").then(() => true), true);
    assert.ok(error instanceof Error);
    assert.match(error.message, /Docker build failed/i);
    assert.match(error.message, /install Docker|start Docker|docker build/i);
});
//# sourceMappingURL=project-context.loose.test.js.map