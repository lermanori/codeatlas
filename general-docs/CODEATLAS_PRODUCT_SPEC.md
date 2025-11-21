# CodeAtlas – Product Specification

CodeAtlas is a developer tool that generates and maintains an **AI-readable documentation system** for any code project. It includes:

- A structured `docs/` folder using Markdown + frontmatter  
- A CLI (`ai-docs`) with multiple commands  
- A small local UI viewer  
- A Cursor rule that enforces AI behavior  
- Automated module generation based on scanning the project  
- Token usage tracking for all AI calls made by CodeAtlas

The system helps AI assistants (Cursor, ChatGPT, Claude, etc.) understand the project architecture and maintain documentation automatically.

---

## 1. Goals

### Primary Goals
1. Improve AI-assisted coding accuracy  
2. Give AI a stable project map it can repeatedly rely on  
3. Automate documentation creation and updates  
4. Let developers visually inspect the documentation tree  
5. Track LLM token usage used by CodeAtlas itself  

### Secondary Goals
- Work with new and existing projects  
- Detect architecture boundaries  
- Provide module suggestions based on repo structure  
- Create module docs with minimum user input  
- Maintain AI changelog and architecture decisions  

---

## 2. Core Features

### 2.1 CLI Tool

Command | Description
--------|------------
`ai-docs init` | Creates doc structure. For existing repos, scans and proposes modules.
`ai-docs add-module` | Adds a module interactively. AI can auto-generate content.
`ai-docs scan` | Builds `ai-tree.json` based on frontmatter.
`ai-docs dev` | Runs a local web viewer for the tree + token stats.

---

## 3. Documentation System

Generated folder structure:

```txt
docs/
  ai-index.md
  ai-rules.md
  ai-decisions.md
  ai-changelog.md
  modules/
    <module>.md
  ai-tree.json   ← generated
```

Each `.md` file must begin with YAML frontmatter:

```yaml
---
id: <unique-id>
title: <Human readable title>
parent: <parent-id or null>
order: <integer>
---
```

The CLI parses these to create a documentation graph.

---

## 4. Module Generation Logic

When `ai-docs init` detects an existing repo:

1. Recursively scan:
   - `src/`, `apps/`, `packages/`, `server/`, `lib/`
2. Extract top-level domain keywords:
   - `auth`, `user`, `billing`, `crm`, `payment`, `invoice`, `order`
3. Send summary → LLM:
   - Ask for 3–7 modules with ids/titles/descriptions
4. Let user approve, rename, or remove modules
5. For each accepted module:
   - Find relevant files (keyword match)
   - Send these filenames → LLM to generate initial content
6. Write module docs

The generation prompt must include:
- Module purpose  
- File list  
- Common patterns  
- Known invariants  

---

## 5. Token Usage Tracking

All LLM calls inside the CLI must pass through a wrapper that:

1. Reads `response.usage.prompt_tokens`, `completion_tokens`, `total_tokens`
2. Logs into `.ai-docs/usage.json`
3. Aggregates by:
   - totals
   - command (`init`, `add-module`)
   - category (`init.suggest-modules`, `add-module.doc`)

This data must be served to `ai-docs dev`.

---

## 6. Viewer UI Requirements

`ai-docs dev` should start a local HTTP server that:

- Serves a static HTML/JS page
- Loads:
  - `/ai-tree.json`
  - `/usage.json`
- Renders a collapsible tree:
  - root → modules  
  - Click to expand children  
  - Show file paths
- Shows token usage totals + breakdown

The UI can be minimal (vanilla JS).

---

## 7. Cursor Rule

Placed at:

```txt
.cursor/rules/codeatlas.mdc
```

Rule behavior:

- Automatically attaches to relevant files (with globs)
- Before writing code:
  - Read `ai-index.md` and `ai-rules.md`
  - Find relevant module documentation
- After making changes:
  - Update module docs if needed
  - Append to `ai-changelog.md`
- Never introduce new frameworks unless allowed
- Follow architecture decisions

---

## 8. Non-Goals

- Not a replacement for TypeDoc/JSDoc  
- Not meant to extract full source-code docs  
- Not meant to sync with external services  
