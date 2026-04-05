# CLAUDE.md

## Default workflow
- Keep `.claude/` ignored and do not commit it.
- By default, after making code changes, run `bun run scripts/build.mjs` once so new `claude-codex` sessions use the latest bundle.
- After the build succeeds and the work is complete, create a git commit for the remaining change unless the user says otherwise.
