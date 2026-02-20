# cli-continues — Gemini AI Summary Patch

This repo contains the patch files for adding `--ai-summary` support to [yigitkonur/cli-continues](https://github.com/yigitkonur/cli-continues).

## Apply the patch

```bash
cd your/cli-continues
git checkout -b feat/gemini-ai-summary

# Copy new file
curl -o src/utils/gemini-summarizer.ts \
  https://raw.githubusercontent.com/Rationaloptimist140/cli-continues-ai-summary-patch/main/src/utils/gemini-summarizer.ts

# Replace resume.ts
curl -o src/utils/resume.ts \
  https://raw.githubusercontent.com/Rationaloptimist140/cli-continues-ai-summary-patch/main/src/utils/resume.ts

# Apply cli.ts patch manually: replace the resume command block
# with the contents of src/cli.ts-resume-block.ts

git add src/utils/gemini-summarizer.ts src/utils/resume.ts src/cli.ts
git commit -m "feat: add --ai-summary flag powered by Gemini 2.0 Flash"
git push origin feat/gemini-ai-summary
```

## Usage after applying

```bash
export CONTINUES_GEMINI_KEY=your-gemini-api-key
continues resume abc123 --in claude --ai-summary
```

## What it does

Before injecting context into the target tool, calls Gemini 2.0 Flash to produce a structured summary:
- **Goal** — what was being built
- **Done** — what was completed
- **Decisions** — key architectural choices
- **Next** — immediate next steps  
- **Warnings** — dead-ends and failures to avoid

Non-fatal: if Gemini fails, falls back to standard handoff silently.
No new npm dependencies — uses Node's built-in fetch (Node 22+ already required).
