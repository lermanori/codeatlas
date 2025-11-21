# CodeAtlas – Developer Task List

This document breaks the entire system into implementation tasks for building CodeAtlas.

---

## 1. Project Bootstrap

- [ ] Initialize Node project with TypeScript.
- [ ] Set `"type": "module"` in `package.json`.
- [ ] Add dependencies:
  - `yargs`
  - `fs-extra`
  - OpenAI client (or equivalent)
- [ ] Set up `tsconfig.json` with `outDir: dist`, `rootDir: src`.

---

## 2. CLI Core

- [ ] Create `src/index.ts`.
- [ ] Configure yargs with commands: `init`, `add-module`, `scan`, `dev`.
- [ ] Ensure compiled CLI has a shebang (`#!/usr/bin/env node`).
- [ ] Add `bin` entry to `package.json` to expose `ai-docs`.

---

## 3. Utility Modules

### 3.1 File Scanner

- [ ] Implement `fileScanner.scanProject(root, options)`:
  - Exclude `node_modules`, `.git`, `dist`, `build`, etc.
  - Return a flat list of file paths.

### 3.2 Frontmatter Parser

- [ ] Implement `frontmatterParser.parse(content)`:
  - Detect YAML block between leading `---` and the next `---`.
  - Return `{ meta, body }`.

### 3.3 Usage Logger

- [ ] Implement `usageLogger.loadUsage()` and `usageLogger.saveUsage()`:
  - Operate on `.ai-docs/usage.json`.
  - Maintain totals, byCommand, byCategory sections.

---

## 4. LLM Client

- [ ] Implement `llmClient.callLLM({ command, category, messages, model? })`.
- [ ] Integrate OpenAI (or equivalent).
- [ ] After receiving response, update `.ai-docs/usage.json`.
- [ ] Handle missing `usage` gracefully.

---

## 5. init Command

- [ ] Detect if repo has existing code.
- [ ] Ensure `docs/` and `docs/modules/` directories exist.
- [ ] Copy templates for:
  - `ai-index.md`
  - `ai-rules.md`
  - `ai-decisions.md`
  - `ai-changelog.md`
- [ ] If code exists:
  - [ ] Scan files using `fileScanner`.
  - [ ] Build a summarized view of the project.
  - [ ] Call `llmClient` to get module suggestions.
  - [ ] Present suggestions in interactive prompt (rename / remove / confirm).
  - [ ] For each confirmed module:
    - [ ] Identify related files by keyword.
    - [ ] Call `llmClient` to generate module documentation content.
    - [ ] Write `docs/modules/<id>.md` with frontmatter and generated content.
- [ ] Optionally copy `templates/codeatlas-rule.mdc` to `.cursor/rules/codeatlas.mdc`.

---

## 6. add-module Command

- [ ] Ask user for:
  - Module name
  - Module id (slug)
  - Parent id (default `root`)
  - Whether to auto-generate content
- [ ] Use `fileScanner` to find related files by keyword (module id and name).
- [ ] If auto-generate is enabled:
  - [ ] Call `llmClient` with file list summary.
  - [ ] Generate module content (purpose, key files, invariants).
- [ ] Write `docs/modules/<id>.md` with proper frontmatter.
- [ ] Optionally run `scan` to refresh `ai-tree.json`.

---

## 7. scan Command

- [ ] Traverse `docs/` and `docs/modules/`.
- [ ] For each `.md` file:
  - [ ] Parse frontmatter.
  - [ ] Extract `id`, `title`, `parent`, `order`.
  - [ ] Resolve relative path.
- [ ] Construct a JSON map and persist as `docs/ai-tree.json`.

---

## 8. dev Command (Viewer)

- [ ] Build a minimal static viewer (`index.html`, `viewer.js`, `style.css`).
- [ ] Implement a simple Node HTTP server:
  - `/` → `index.html`
  - `/viewer.js` → JS bundle
  - `/style.css` → CSS
  - `/ai-tree.json` → reads `docs/ai-tree.json`
  - `/usage.json` → reads `.ai-docs/usage.json` if exists
- [ ] Implement frontend logic:
  - [ ] Load `ai-tree.json`.
  - [ ] Build collapsible tree starting at `root`.
  - [ ] Load `usage.json` and show token totals.

---

## 9. Cursor Rule

- [ ] Add `templates/codeatlas-rule.mdc`.
- [ ] Ensure rule instructs Cursor to:
  - Read `ai-index.md` and `ai-rules.md`.
  - Consult relevant module docs.
  - Update `ai-changelog.md`.
  - Update module docs when behavior changes.

---

## 10. Packaging & Publishing

- [ ] Verify `npm pack` works.
- [ ] Test global install with `npm link`.
- [ ] Publish to npm with `npm publish --access public`.
