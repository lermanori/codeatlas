# CodeAtlas – Technical Architecture Document

This document describes the internal architecture required to implement CodeAtlas.

---

## 1. Code Structure Overview

```txt
packages/
  cli/
    src/
      commands/
        init.ts
        addModule.ts
        scan.ts
        dev.ts
      templates/
        docs/
        codeatlas-rule.mdc
      llm/
        llmClient.ts
      utils/
        fileScanner.ts
        frontmatterParser.ts
        usageLogger.ts
      index.ts
  viewer/
    index.html
    viewer.js
    style.css
```

For v1, a single package is fine; the structure above is conceptual.

---

## 2. Core Components

### 2.1 CLI Entry

- File: `packages/cli/src/index.ts`
- Uses `yargs` to expose commands:
  - `init`
  - `add-module`
  - `scan`
  - `dev`
- Compiled to `dist` and exposed as `bin` in `package.json` with name `ai-docs`.

---

## 3. init Command Architecture

### Behavior

1. Detect if repo has existing code:
   - Check for `src/`, `apps/`, `packages/`, `server/`, `lib/`.
2. Ensure:
   - `docs/` directory exists
   - `docs/modules/` exists
3. Copy template docs into `docs/` if missing:
   - `ai-index.md`
   - `ai-rules.md`
   - `ai-decisions.md`
   - `ai-changelog.md`
4. If the repo has substantive code:
   - Use `fileScanner` to collect a list of files.
   - Summarize structure and call LLM via `llmClient` to propose modules.
   - Prompt the user to confirm / rename / drop proposed modules.
   - For each accepted module:
     - Use LLM to generate module documentation using relevant files.
5. Optionally create `.cursor/rules/codeatlas.mdc` from template.

### Required Helpers

- `fileScanner.scanProject(root, options)`  
  - Recursively traverses directories except `node_modules`, `.git`, `dist`, etc.
- `moduleDetector.suggestModules(fileList)`  
  - Uses LLM to propose a list of modules.
- `moduleGenerator.generateModuleDoc(moduleMeta, relatedFiles)`  
  - Uses LLM to generate the body of the module markdown.

---

## 4. add-module Command Architecture

### Steps

1. Prompt the user for:
   - `Module Name` (e.g., "CRM")
   - `Module ID` (slug; default from name, e.g., `crm`)
   - `Parent ID` (defaults to `root`)
   - Whether to auto-generate content from project files.
2. Use `fileScanner` to search for related files by keyword (e.g., names containing `crm`, `lead`, `customer`).
3. If AI generation is enabled:
   - Call `llmClient` with a summary of relevant files.
   - Ask the LLM for:
     - Module purpose
     - Key files
     - Important entities/types
     - Constraints / invariants
4. Write `docs/modules/<id>.md` with:
   - YAML frontmatter (`id`, `title`, `parent`, `order`)
   - Generated or stub content.
5. Optionally run `scan` to update `ai-tree.json`.

---

## 5. scan Command Architecture

### Steps

1. Recursively walk all `.md` files under `docs/`.
2. For each file:
   - Parse YAML frontmatter using `frontmatterParser`.
   - Extract `id`, `title`, `parent`, `order`.
   - Compute relative path from project root.
3. Build a JSON object:

```json
{
  "root": {
    "id": "root",
    "title": "Project Overview",
    "parent": null,
    "order": 0,
    "path": "docs/ai-index.md"
  },
  "billing": {
    "id": "billing",
    "title": "Billing Module",
    "parent": "root",
    "order": 20,
    "path": "docs/modules/billing.md"
  }
}
```

4. Write this object to `docs/ai-tree.json`.

---

## 6. dev Command Architecture

### Responsibilities

- Start an HTTP server (using Node's `http` module).
- Serve:
  - `/` → `index.html` (viewer UI)
  - `/viewer.js` → JS bundle
  - `/style.css` → optional styling
  - `/ai-tree.json` → proxy to `docs/ai-tree.json`
  - `/usage.json` → proxy to `.ai-docs/usage.json` if it exists

### Viewer UI

- Written as a simple static app:
  - Fetch `/ai-tree.json` and build a collapsible tree.
  - Fetch `/usage.json` and display token usage statistics.
- No external build tools required in v1 (plain JS is OK).

---

## 7. LLM Client

### Location

- File: `packages/cli/src/llm/llmClient.ts`

### Responsibilities

- Provide a function:

```ts
callLLM({
  command,
  category,
  messages,
  model?
}): Promise<OpenAI.Chat.Completions.ChatCompletion>
```

- Use OpenAI (or similar) to send chat completions.
- Read `response.usage` and log:

  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`

- Log structure in `.ai-docs/usage.json`:

```json
{
  "totals": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "byCommand": {
    "init": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
  },
  "byCategory": {
    "init.suggest-modules": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
  }
}
```

- Provide helper functions to read and update this JSON file.

---

## 8. Cursor Rule Specification

### Location

```txt
.cursor/rules/codeatlas.mdc
```

### Intent

- Auto-attached rule that instructs Cursor:

  - **Before editing code:**
    - Read `docs/ai-index.md` and `docs/ai-rules.md`.
    - Identify and read the relevant module doc in `docs/modules/`.
  - **While editing code:**
    - Respect `ai-decisions.md` (architecture decisions).
  - **After editing:**
    - Append an entry to `docs/ai-changelog.md`.
    - Update module docs when functionality or invariants change.

- The rule is included as a template in `templates/codeatlas-rule.mdc` and copied into the user repo by `init`.

---

## 9. Frontmatter Specification

Each `.md` file must include at minimum:

```yaml
id: string            # Unique identifier within the tree
title: string         # Human-readable label
parent: string | null # Parent id (or null for root)
order: number         # Sorting order among siblings
```

If missing, the scanner should skip the file or attempt best-effort defaults.

---

## 10. Viewer UI

### Minimum Requirements

- Collapsible tree:
  - Node label: `title`
  - Optional path subtext
- Token usage panel:
  - Show totals from `usage.json`
  - If no file exists, show "No LLM usage recorded yet."

The UI should be self-contained and not depend on any external services.
