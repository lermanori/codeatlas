# CodeAtlas – Cursor Prompt Bundle

This file contains ready-to-use prompts for building and maintaining CodeAtlas with Cursor.

---

## 1. Master System Prompt for Building CodeAtlas

Use this as the **Ask/Plan mode** prompt when you open a new Cursor chat in the CodeAtlas repo:

> You are an expert TypeScript/Node.js developer and toolsmith.  
> Your task is to design and implement the CodeAtlas CLI tool and its associated viewer UI exactly as specified in the following documents:
>
> - CODEATLAS_PRODUCT_SPEC.md  
> - CODEATLAS_ARCHITECTURE.md  
> - CODEATLAS_DEV_TASKS.md  
>
> Rules:
> 1. Always read or skim the above docs before implementing new features.
> 2. Always start in Ask/Plan mode: produce a short plan (numbered steps) before editing files.
> 3. Respect the file structure and naming described in the architecture doc.
> 4. Keep functions small and focused, and prefer clear, explicit types.
> 5. Whenever you introduce new behavior, ensure it is consistent with the product spec.
> 6. After each major change, summarize what you did and which files were touched.
>
> Goal: Make CodeAtlas production-ready, with a clean CLI (`ai-docs`), documentation templates, LLM wrapper with token tracking, a working viewer, and a robust init/add-module/scan/dev workflow.

---

## 2. Prompt: Implement CLI Skeleton

Use this when starting the implementation:

> Task: Implement the basic CLI skeleton for CodeAtlas.
>
> Scope:
> - Create `src/index.ts` using yargs.
> - Register commands: `init`, `add-module`, `scan`, `dev` (empty handlers or stubs are okay for now).
> - Set up proper TypeScript configs and ensure build outputs to `dist`.
> - Make sure the generated binary can be executed as `ai-docs` via the `bin` entry in package.json.
>
> Constraints:
> - Follow the structure described in CODEATLAS_ARCHITECTURE.md.
> - Keep command modules in `src/commands/`.
> - Do not implement full logic for commands yet, just the wiring and stubs.

---

## 3. Prompt: Implement LLM Client + Token Logging

Use when you’re ready to build the LLM core:

> Task: Implement the LLM client and token usage tracking for CodeAtlas.
>
> Requirements:
> - Read CODEATLAS_ARCHITECTURE.md and CODEATLAS_DEV_TASKS.md (sections about the LLM client).
> - Implement `llmClient.callLLM({ command, category, messages, model? })` in `src/llm/llmClient.ts`.
> - Integrate with OpenAI (or a pluggable interface).
> - Record `prompt_tokens`, `completion_tokens`, and `total_tokens` from `response.usage`.
> - Maintain `.ai-docs/usage.json` with structure:
>   - `totals`
>   - `byCommand`
>   - `byCategory`
> - Provide helper functions to load and save this JSON file.
>
> Constraints:
> - Be resilient to missing `usage` (older models or errors).
> - All command implementations (`init`, `add-module`, etc.) must use this client instead of calling the LLM directly.

---

## 4. Prompt: Implement `init` Command with Module Suggestions

> Task: Implement the `init` command for CodeAtlas with module suggestion for existing projects.
>
> Requirements:
> - Behavior is fully defined in CODEATLAS_PRODUCT_SPEC.md and CODEATLAS_ARCHITECTURE.md.
> - Steps:
>   1. Ensure `docs/` and `docs/modules/` exist.
>   2. Copy template docs (ai-index, ai-rules, ai-decisions, ai-changelog) if missing.
>   3. Detect whether the repo has code (look for `src/`, `apps/`, etc.).
>   4. If code exists:
>      - Use `fileScanner` to collect a list of relevant files.
>      - Summarize the structure.
>      - Use `llmClient.callLLM` with category `init.suggest-modules` to propose a set of modules.
>      - Present the suggested modules to the user in the terminal (name, id, description).
>      - Allow the user to:
>        - Accept all
>        - Deselect some
>        - Edit ids/names
>      - For each accepted module:
>        - Identify related files by name/keyword.
>        - Use `llmClient.callLLM` with category `init.module-docs` to generate the content for the module doc.
>        - Write `docs/modules/<id>.md` with proper frontmatter and generated body.
>   5. If `--cursor` flag is provided:
>      - Copy the Cursor rule template into `.cursor/rules/codeatlas.mdc` if not present.
>
> - After completion, print a short summary:
>   - Which docs were created
>   - Which modules were generated
>   - Approximate token usage (read from `usage.json` for this command)

---

## 5. Prompt: Implement `add-module` Command

> Task: Implement the `add-module` command for CodeAtlas.
>
> Requirements:
> - See CODEATLAS_ARCHITECTURE.md and CODEATLAS_DEV_TASKS.md (section 6).
> - Behavior:
>   1. Prompt the user for:
>      - Module name
>      - Module id (suggested from name)
>      - Parent id (default `root`)
>      - Whether to auto-generate content using AI.
>   2. Use `fileScanner` to detect related files (match id/name against file and folder names).
>   3. If auto-generate = yes:
>      - Summarize the related files.
>      - Call `llmClient.callLLM` with category `add-module.doc` to generate:
>        - Purpose
>        - Key files
>        - Important entities/types
>        - Constraints / invariants
>   4. Write `docs/modules/<id>.md` with:
>      - Frontmatter (id,title,parent,order)
>      - Generated or placeholder content.
>   5. Optionally trigger `scan` or at least instruct the user to run `ai-docs scan`.
>
> Constraints:
> - Do not overwrite existing module docs with the same id.
> - Keep the flow interactive but not noisy.

---

## 6. Prompt: Implement `scan` and `dev` Commands

> Task: Implement `scan` (tree builder) and `dev` (viewer server).
>
> Requirements:
> - `scan`:
>   - Traverse `docs/`.
>   - Parse all `.md` frontmatter using `frontmatterParser`.
>   - Build the JSON structure described in CODEATLAS_ARCHITECTURE.md.
>   - Save to `docs/ai-tree.json`.
> - `dev`:
>   - Start a small HTTP server.
>   - Serve static `index.html`, `viewer.js`, `style.css`.
>   - Serve `ai-tree.json` from `docs/`.
>   - Serve `usage.json` from `.ai-docs/`.
>   - Viewer:
>     - Shows a collapsible tree starting from `root`.
>     - Shows a token usage panel.
>
> Constraints:
> - No external bundlers for v1; just plain JS/HTML/CSS.

---

## 7. Prompt: Implement Cursor Rule Template

> Task: Implement the CodeAtlas Cursor rule file.
>
> Requirements:
> - Create `templates/codeatlas-rule.mdc` as described in the product and architecture docs.
> - The rule should:
>   - Auto-attach to relevant file globs.
>   - Instruct the model to:
>     - Read `docs/ai-index.md` and `docs/ai-rules.md` at the start of a session.
>     - Read the relevant `docs/modules/*.md` for the current task.
>     - Respect `docs/ai-decisions.md`.
>     - Update `docs/ai-changelog.md` and affected module docs after changes.
> - Ensure `init --cursor` copies this template into `.cursor/rules/codeatlas.mdc` if not present.
>
> Output:
> - A single `.mdc` file that Cursor can interpret as a rule.

---

## 8. Prompt: Hardening & Polish

> Task: Hardening the CodeAtlas project for initial release.
>
> Requirements:
> - Add helpful CLI messages and error handling.
> - Ensure graceful behavior when:
>   - `docs/` or files are missing.
>   - `.ai-docs/usage.json` doesn’t exist yet.
>   - No code files are present (e.g., new empty repo).
> - Add comments in the code where the architecture expects future extension.
> - Make sure TypeScript types are clean and strict.
> - Write a minimal README.md that:
>   - Explains CodeAtlas purpose.
>   - Shows basic usage.
>   - Mentions token tracking and viewer.

---

## 9. How to Use This Bundle

1. Place all four docs in the root of the CodeAtlas repo:
   - `CODEATLAS_PRODUCT_SPEC.md`
   - `CODEATLAS_ARCHITECTURE.md`
   - `CODEATLAS_DEV_TASKS.md`
   - `CODEATLAS_CURSOR_PROMPTS.md`
2. In Cursor:
   - Open the repo.
   - Create a new chat.
   - Paste the **Master System Prompt** from section 1.
   - Work feature-by-feature using the focused prompts in sections 2–8.
3. Always use Ask/Plan mode first, then switch to Agent mode once the plan looks correct.
