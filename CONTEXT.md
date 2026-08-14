# Big Brain

Big Brain orchestrates AI coding agents against local repositories. Its language distinguishes agent execution, sandbox isolation, git branch isolation, and run artifacts.

## Language

**Run**:
One attempt to execute an Agent Provider against an inline Prompt in a target repository.
_Avoid_: Job, task, session

**Agent Provider**:
Code that turns a Prompt into an agent subprocess.
_Avoid_: Agent command, model provider

**Sandbox Provider**:
Code that decides where the agent subprocess runs and how the target repository is mounted there.
_Avoid_: Worktree provider, runner

**Docker Sandbox**:
A Sandbox Provider that runs the agent subprocess inside a Docker container.
_Avoid_: Docker runner, container runner

**Branch Strategy**:
The rule for whether a Run uses the current working tree or a branch worktree.
_Avoid_: Checkout mode, git mode

**Worktree**:
A git worktree used for branch isolation, not a Sandbox.
_Avoid_: Sandbox, clone

**Prompt**:
The user-authored instruction text supplied to a Run.
_Avoid_: Task, request

**Run Artifact**:
A log or result file written for a Run under `.big-brain/runs`.
_Avoid_: Persistence record, database record

**Completion Signal**:
Text emitted by an agent subprocess that tells Big Brain the Run has logically finished.
_Avoid_: Done marker, stop token

**Agent Command**:
A CLI command string used by the `bb run` wrapper to start an agent subprocess.
_Avoid_: Agent Provider, shell script
