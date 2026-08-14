# Big Brain

Big Brain is a personal TypeScript AI orchestration project. The first milestone is a local `bb` CLI that initializes project-local orchestration context for future planning, coding, testing, reviewing, and MCP-driven workflows.

## Usage

Install dependencies:

```sh
npm install
```

Build the CLI:

```sh
npm run build
```

Run tests:

```sh
npm test
```

Initialize a project context from the repo root or any target project directory:

```sh
npm run bb -- init --name my-project
```

This creates:

- `.big-brain/config.json`
- `.big-brain/big-brain.sqlite`
- `.big-brain/runs/`
- `.big-brain/artifacts/`
- `.big-brain/docs/`

If `.big-brain/` already exists, `bb init` exits with an already-initialized message. To regenerate that folder, run:

```sh
npm run bb -- init --name my-project --force
```

`--force` deletes and recreates only `.big-brain/`. It does not modify files outside that directory.

List the skills available in this repo:

```sh
npm run bb -- skills
```

Inspect one skill:

```sh
npm run bb -- skills show research
```

Search skills by name, description, or instructions:

```sh
npm run bb -- skills search "debug intermittent bug"
```

## Configuration

Generated config is JSON and does not store secrets. Future OpenAI calls will read credentials from `OPENAI_API_KEY`.

The initial config includes:

- `projectName`
- `configVersion`
- `bigBrainVersion`
- `createdAt`
- `defaultModel`
- project-local paths

## Architecture

This repo is intentionally a single TypeScript package with app-style folders:

- `src/cli`: Commander-based CLI entrypoints.
- `src/core`: application services shared by CLI and future MCP adapters.
- `src/db`: raw SQLite initialization using `better-sqlite3`.
- `src/skills`: deterministic registry for `.agents/skills` discovery, inspection, and search.
- `src/mcp`: reserved for the future `bb mcp` stdio server.
- `src/workflows`: reserved for TypeScript-defined orchestration workflows.

The CLI drives the product design. Future MCP tools should wrap CLI-equivalent operations rather than becoming a separate product surface.

The project-local SQLite database starts with `project`, `runs`, `artifacts`, and `decisions` tables. Workflow-specific payloads use JSON text columns so the orchestration model can evolve without immediate schema churn.

Skills are currently exposed as read-only project resources. Big Brain can list, show, and search `.agents/skills/*/SKILL.md` plus source metadata from `skills-lock.json`. Future MCP tools and passive background agents should use the same registry instead of reimplementing skill discovery.
