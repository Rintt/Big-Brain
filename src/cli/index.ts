#!/usr/bin/env node
import { Command } from "commander";
import { AlreadyInitializedError, initProject } from "../core/project-context.js";

export function createCli(): Command {
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
    .action(async (options: { name: string; force?: boolean }) => {
      try {
        const result = await initProject({ cwd: process.cwd(), name: options.name, force: options.force });
        console.log(`Initialized Big Brain project context at ${result.projectDir}`);
      } catch (error) {
        if (error instanceof AlreadyInitializedError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });

  program
    .command("mcp")
    .description("Start the Big Brain stdio MCP server")
    .action(() => {
      console.error("bb mcp is reserved for a future milestone.");
      process.exitCode = 1;
    });

  return program;
}

await createCli().parseAsync(process.argv);
