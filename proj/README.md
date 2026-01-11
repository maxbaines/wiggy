# Project Starter Files

This folder contains everything you need to start a new project with Little Wiggy.

## Files

| File                        | Description                                   |
| --------------------------- | --------------------------------------------- |
| `wiggy`                     | **The executable** (Mac ARM64)                |
| `ralph.config.example.json` | Configuration template - copy and add API key |
| `AGENTS.md`                 | Project guidelines template for the AI agent  |
| `prd.example.md`            | Example PRD structure (Markdown format)       |
| `.gitignore.template`       | Common gitignore patterns                     |

## Quick Start

1. **Copy files to your project:**

   ```bash
   cp proj/wiggy myproject/
   cp proj/ralph.config.example.json myproject/ralph.config.json
   cp proj/AGENTS.md myproject/
   cp proj/.gitignore.template myproject/.gitignore
   ```

2. **Configure:**

   - Edit `ralph.config.json` and add your Anthropic API key
   - Edit `AGENTS.md` with your project details

3. **Generate a PRD:**

   ```bash
   cd myproject
   wiggy init "Your project description here"
   ```

4. **Run Little Wiggy:**
   ```bash
   wiggy 5 --hitl
   ```

## Or Use the Init Command

Instead of copying files manually, you can use Little Wiggy to generate a PRD:

```bash
cd myproject
wiggy init "Build a CLI tool that converts markdown to HTML" --analyze
```

This will:

- Analyze your existing codebase (if any)
- Generate a structured PRD in Markdown format
- Save it as `prd.md`

## PRD Categories

When creating your PRD, use these categories:

| Category        | Priority | Description                            |
| --------------- | -------- | -------------------------------------- |
| `setup`         | high     | Project initialization, dependencies   |
| `architecture`  | high     | Core abstractions, patterns, structure |
| `functional`    | medium   | Features, business logic               |
| `testing`       | medium   | Tests, coverage                        |
| `documentation` | low      | README, comments, docs                 |
| `polish`        | low      | Cleanup, refactoring, optimization     |

## Task Completion

Little Wiggy automatically marks tasks as complete in your PRD:

- **Incomplete tasks**: `- [ ] **Task description**`
- **Completed tasks**: `- [DONE] **Task description**`

When a task is completed:

1. Progress is written to `progress.txt`
2. The task is marked as `[DONE]` in the PRD file
3. You can see the full history of what was done

## Tips

1. **Start with HITL mode** - Watch what Little Wiggy does before going AFK
2. **Keep tasks atomic** - One logical change per task
3. **Be specific** - Include acceptance criteria in your PRD steps
4. **Use AGENTS.md** - Tell the agent about your project's conventions
5. **Check progress.txt** - Review what was done between iterations
