#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { AlreadyInitializedError, initProject } from "../core/project-context.js";
import { run } from "../core/run.js";
import { getSkill, listSkills } from "../skills/registry.js";
import { searchSkills } from "../skills/search.js";
export function createCli() {
    const program = new Command();
    program
        .name("bb")
        .description("Big Brain personal AI orchestration CLI")
        .version("0.1.0");
    program
        .command("init")
        .description("Initialize Big Brain project context in the current directory")
        .requiredOption("--name <name>", "Project name")
        .option("--force", "Regenerate .big-brain by overwriting only that directory")
        .action(async (options) => {
        try {
            const result = await initProject({ cwd: process.cwd(), name: options.name, force: options.force });
            console.log(`Initialized Big Brain project context at ${result.projectDir}`);
        }
        catch (error) {
            if (error instanceof AlreadyInitializedError) {
                console.error(error.message);
                process.exitCode = 1;
                return;
            }
            throw error;
        }
    });
    program
        .command("run")
        .description("Run an agent command")
        .requiredOption("--name <name>", "Run name")
        .option("--branch <branch>", "Run in an internal worktree for the named branch")
        .requiredOption("--agent-command <command>", "Agent command to execute")
        .requiredOption("--prompt <prompt>", "Prompt to pass to the agent via stdin")
        .action(async (options) => {
        const branchStrategy = options.branch === undefined ? undefined : { type: "branch", branch: options.branch };
        const result = await run({ cwd: process.cwd(), name: options.name, branchStrategy, agentCommand: options.agentCommand, prompt: options.prompt });
        if (result.status === "failed") {
            const log = await readFile(result.logPath, "utf8");
            if (/docker: not found|spawn docker ENOENT|cannot connect to the docker daemon|is the docker daemon running/i.test(log)) {
                console.error("Docker must be installed and running to use bb run with the Docker Sandbox.");
            }
            process.exitCode = 1;
        }
    });
    program
        .command("mcp")
        .description("Start the Big Brain stdio MCP server")
        .action(() => {
        console.error("bb mcp is reserved for a future milestone.");
        process.exitCode = 1;
    });
    const skills = program.command("skills").description("List, inspect, and search repo-local agent skills");
    skills
        .command("list", { isDefault: true })
        .description("List skills from .agents/skills")
        .action(async () => {
        const allSkills = await listSkills({ cwd: process.cwd() });
        if (allSkills.length === 0) {
            console.log("No skills found at .agents/skills.");
            return;
        }
        for (const skill of allSkills) {
            const invocation = skill.disableModelInvocation ? "user-invoked" : "model-invoked";
            const description = skill.description ? ` - ${skill.description}` : "";
            console.log(`${skill.name} (${invocation})${description}`);
        }
    });
    skills
        .command("show")
        .description("Show a skill's metadata and instructions")
        .argument("<name>", "Skill name")
        .action(async (name) => {
        const skill = await getSkill({ cwd: process.cwd(), name });
        if (skill === null) {
            console.error(`Skill not found: ${name}`);
            process.exitCode = 1;
            return;
        }
        console.log(`Name: ${skill.name}`);
        console.log(`Path: ${skill.path}`);
        console.log(`Invocation: ${skill.disableModelInvocation ? "user-invoked" : "model-invoked"}`);
        console.log(`Description: ${skill.description ?? ""}`);
        if (skill.source) {
            console.log(`Source: ${skill.source.source} (${skill.source.sourceType})`);
            console.log(`Source path: ${skill.source.skillPath}`);
        }
        if (skill.agentConfigs.length > 0) {
            console.log(`Agent configs: ${skill.agentConfigs.join(", ")}`);
        }
        console.log("\n---\n");
        console.log(skill.body.trimEnd());
    });
    skills
        .command("search")
        .description("Search skill names, descriptions, and instructions")
        .argument("<query>", "Search query")
        .action(async (query) => {
        const results = await searchSkills({ cwd: process.cwd(), query });
        if (results.length === 0) {
            console.log("No matching skills found.");
            return;
        }
        for (const result of results) {
            const description = result.skill.description ? ` - ${result.skill.description}` : "";
            console.log(`${result.skill.name} [score ${result.score}]${description}`);
        }
    });
    return program;
}
await createCli().parseAsync(process.argv);
//# sourceMappingURL=index.js.map