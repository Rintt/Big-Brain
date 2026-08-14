import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillDocument } from "./frontmatter.js";
import { getSkill, listSkills } from "./registry.js";
import { searchSkills } from "./search.js";
test("parseSkillDocument reads simple skill frontmatter", () => {
    const parsed = parseSkillDocument(`---
name: research
description: "Research primary sources."
disable-model-invocation: true
---

# Research

Do the reading.
`);
    assert.deepEqual(parsed.frontmatter, {
        name: "research",
        description: "Research primary sources.",
        disableModelInvocation: true
    });
    assert.equal(parsed.body.startsWith("# Research"), true);
});
test("listSkills reads skill metadata and lockfile source", async () => {
    const cwd = await makeRepoWithSkill({
        folderName: "research",
        skill: `---
name: research
description: Research primary sources.
---

# Research

Read docs.
`
    });
    await writeFile(path.join(cwd, "skills-lock.json"), JSON.stringify({
        version: 1,
        skills: {
            research: {
                source: "mattpocock/skills",
                sourceType: "github",
                skillPath: "skills/engineering/research/SKILL.md",
                computedHash: "abc123"
            }
        }
    }), "utf8");
    await mkdir(path.join(cwd, ".agents", "skills", "research", "agents"));
    await writeFile(path.join(cwd, ".agents", "skills", "research", "agents", "openai.yaml"), "model: test", "utf8");
    const skills = await listSkills({ cwd });
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, "research");
    assert.equal(skills[0]?.description, "Research primary sources.");
    assert.equal(skills[0]?.disableModelInvocation, false);
    assert.equal(skills[0]?.source?.computedHash, "abc123");
    assert.equal(skills[0]?.agentConfigs.length, 1);
});
test("getSkill matches skill name or folder name", async () => {
    const cwd = await makeRepoWithSkill({
        folderName: "skill-folder",
        skill: `---
name: canonical-name
---

# Skill
`
    });
    assert.equal((await getSkill({ cwd, name: "canonical-name" }))?.name, "canonical-name");
    assert.equal((await getSkill({ cwd, name: "skill-folder" }))?.name, "canonical-name");
    assert.equal(await getSkill({ cwd, name: "missing" }), null);
});
test("searchSkills searches name, description, and body", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-skills-"));
    await makeSkill(cwd, "research", `---
name: research
description: Investigate primary sources.
---

# Research
`);
    await makeSkill(cwd, "debug", `---
name: diagnosing-bugs
description: Fix hard bugs.
---

# Diagnosing Bugs

Create a tight feedback loop.
`);
    const results = await searchSkills({ cwd, query: "tight bug" });
    assert.equal(results[0]?.skill.name, "diagnosing-bugs");
    assert.equal(results[0]?.score, 6);
});
async function makeRepoWithSkill(options) {
    const cwd = await mkdtemp(path.join(tmpdir(), "big-brain-skills-"));
    await makeSkill(cwd, options.folderName, options.skill);
    return cwd;
}
async function makeSkill(cwd, folderName, skill) {
    const skillDir = path.join(cwd, ".agents", "skills", folderName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skill, "utf8");
}
//# sourceMappingURL=registry.test.js.map