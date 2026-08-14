import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSkillDocument } from "./frontmatter.js";
export async function listSkills(options) {
    const skillsDir = path.join(options.cwd, ".agents", "skills");
    const lock = await readSkillsLock(options.cwd);
    const entries = await safeReadDir(skillsDir, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const folderName = entry.name;
        const skillPath = path.join(skillsDir, folderName, "SKILL.md");
        const content = await safeReadFile(skillPath);
        if (content === null) {
            continue;
        }
        const parsed = parseSkillDocument(content);
        const name = parsed.frontmatter.name ?? folderName;
        const agentConfigs = await listAgentConfigs(path.join(skillsDir, folderName));
        skills.push({
            name,
            folderName,
            path: skillPath,
            description: parsed.frontmatter.description ?? null,
            disableModelInvocation: parsed.frontmatter.disableModelInvocation ?? false,
            body: parsed.body,
            source: lock.skills?.[name] ?? lock.skills?.[folderName] ?? null,
            agentConfigs
        });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
}
export async function getSkill(options) {
    const skills = await listSkills(options);
    return skills.find((skill) => skill.name === options.name || skill.folderName === options.name) ?? null;
}
async function listAgentConfigs(skillDir) {
    const agentsDir = path.join(skillDir, "agents");
    const entries = await safeReadDir(agentsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml")).map((entry) => path.join(agentsDir, entry.name)).sort();
}
async function readSkillsLock(cwd) {
    const lockContent = await safeReadFile(path.join(cwd, "skills-lock.json"));
    if (lockContent === null) {
        return {};
    }
    return JSON.parse(lockContent);
}
async function safeReadFile(filePath) {
    try {
        return await readFile(filePath, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
async function safeReadDir(dirPath, options) {
    try {
        return await readdir(dirPath, options);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
//# sourceMappingURL=registry.js.map