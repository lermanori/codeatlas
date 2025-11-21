---
id: ai-rules
title: AI Rules
parent: root
order: 10
---

# AI Rules and Guidelines

This document defines rules and guidelines for AI assistants working on this project.

## Code Style

[Define your code style preferences here]

- [Example: Use TypeScript with strict mode]
- [Example: Follow ESLint configuration]
- [Example: Prefer functional programming patterns]

## Architecture Constraints

[Define architectural constraints]

- [Example: Do not introduce new frameworks without approval]
- [Example: Follow existing patterns for API design]
- [Example: Maintain backward compatibility]

## Update Procedures

When making changes to the codebase:

1. **Before editing:**
   - Read relevant module documentation in `modules/`
   - Review `ai-decisions.md` for relevant architecture decisions
   - Understand the current implementation

2. **While editing:**
   - Follow code style guidelines
   - Respect architecture constraints
   - Maintain existing patterns where possible

3. **After editing:**
   - Update `ai-changelog.md` with:
     - Date of change
     - Files modified
     - Summary of changes
   - Update module documentation if:
     - Functionality changed
     - Invariants changed
     - New patterns were introduced

## Module Documentation

Module documentation in `modules/` should be kept up to date. When functionality changes:

- Update the module's purpose if it has changed
- Update the list of key files
- Update important entities/types if they changed
- Update constraints/invariants if they changed

## Testing

[Define testing requirements]

- [Example: All new code must have tests]
- [Example: Maintain test coverage above X%]

## Dependencies

[Define dependency management rules]

- [Example: Do not add new dependencies without review]
- [Example: Keep dependencies up to date]

