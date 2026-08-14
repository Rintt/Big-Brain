import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { parseSkillDocument } from "./frontmatter.js";

export type SkillSource = {
  source: string;
  sourceType: string;
  skillPath: string;
  computedHash: string;
};

export type Skill = {
  name: string;
  folderName: string;
  path: string;
  description: string | null;
  disableModelInvocation: boolean;
  body: string;
  source: SkillSource | null;
  agentConfigs: string[];
};

export type ListSkillsOptions = {
  cwd: string;
};

type SkillsLock = {
  skills?: Record<string, SkillSource>;
};

export async function listSkills(options: ListSkillsOptions): Promise<Skill[]> {
  const skillsDir = path.join(options.cwd, ".agents", "skills");
  const lock = await readSkillsLock(options.cwd);
  const entries = await safeReadDir(skillsDir, { withFileTypes: true });
  const skills: Skill[] = [];

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

export async function getSkill(options: ListSkillsOptions & { name: string }): Promise<Skill | null> {
  const skills = await listSkills(options);
  return skills.find((skill) => skill.name === options.name || skill.folderName === options.name) ?? null;
}

async function listAgentConfigs(skillDir: string): Promise<string[]> {
  const agentsDir = path.join(skillDir, "agents");
  const entries = await safeReadDir(agentsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml")).map((entry) => path.join(agentsDir, entry.name)).sort();
}

async function readSkillsLock(cwd: string): Promise<SkillsLock> {
  const lockContent = await safeReadFile(path.join(cwd, "skills-lock.json"));
  if (lockContent === null) {
    return {};
  }

  return JSON.parse(lockContent) as SkillsLock;
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function safeReadDir(
  dirPath: string,
  options: { withFileTypes: true }
): Promise<Array<Dirent<string>>> {
  try {
    return await readdir(dirPath, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
