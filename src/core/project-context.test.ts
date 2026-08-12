import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { AlreadyInitializedError, initProject } from "./project-context.js";

test("initProject creates structured project context", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-init-"));
  const now = new Date("2026-08-12T00:00:00.000Z");

  const result = await initProject({ cwd, name: "demo", now });

  assert.equal(result.projectDir, path.join(cwd, ".big-brain"));
  await assertDirectory(path.join(cwd, ".big-brain", "runs"));
  await assertDirectory(path.join(cwd, ".big-brain", "artifacts"));
  await assertDirectory(path.join(cwd, ".big-brain", "docs"));

  const config = JSON.parse(await readFile(path.join(cwd, ".big-brain", "config.json"), "utf8"));
  assert.equal(config.projectName, "demo");
  assert.equal(config.configVersion, 1);
  assert.equal(config.bigBrainVersion, "0.1.0");
  assert.equal(config.createdAt, now.toISOString());
  assert.equal(config.defaultModel, "gpt-5.5");
  assert.deepEqual(config.paths, {
    database: ".big-brain/big-brain.sqlite",
    runs: ".big-brain/runs",
    artifacts: ".big-brain/artifacts",
    docs: ".big-brain/docs"
  });

  const db = new Database(path.join(cwd, ".big-brain", "big-brain.sqlite"), { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((table) => table.name), ["artifacts", "decisions", "project", "runs"]);

    const project = db.prepare("SELECT name, created_at FROM project WHERE id = 1").get() as { name: string; created_at: string };
    assert.deepEqual(project, { name: "demo", created_at: now.toISOString() });
  } finally {
    db.close();
  }
});

test("initProject refuses an existing project context without force", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-init-"));

  await initProject({ cwd, name: "demo" });

  await assert.rejects(
    initProject({ cwd, name: "demo" }),
    (error) => error instanceof AlreadyInitializedError && error.message.includes("--force")
  );
});

test("initProject force regenerates only the .big-brain directory", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-init-"));
  const outsideFile = path.join(cwd, "keep.txt");

  await initProject({ cwd, name: "demo" });
  await writeFile(path.join(cwd, ".big-brain", "docs", "old.md"), "old", "utf8");
  await writeFile(outsideFile, "keep", "utf8");

  await initProject({ cwd, name: "demo-2", force: true });

  await assert.rejects(readFile(path.join(cwd, ".big-brain", "docs", "old.md"), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(outsideFile, "utf8"), "keep");

  const config = JSON.parse(await readFile(path.join(cwd, ".big-brain", "config.json"), "utf8"));
  assert.equal(config.projectName, "demo-2");
});

async function assertDirectory(directoryPath: string): Promise<void> {
  const stats = await stat(directoryPath);
  assert.equal(stats.isDirectory(), true);
}
