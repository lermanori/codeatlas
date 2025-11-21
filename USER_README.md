# CodeAtlas

> Generate and maintain AI-readable documentation for your code projects

CodeAtlas is a developer tool that creates a structured documentation system optimized for AI assistants like Cursor, ChatGPT, and Claude. It helps AI understand your project architecture and automatically maintains documentation as your codebase evolves.

[![npm version](https://img.shields.io/npm/v/codeatlas)](https://www.npmjs.com/package/codeatlas)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

## ✨ Features

- 🤖 **AI-Powered Documentation**: Automatically generate module documentation using LLMs
- 📁 **Structured Documentation**: Markdown files with YAML frontmatter for easy parsing
- 🎯 **Smart Module Detection**: Scans your codebase and suggests modules based on structure
- 🖥️ **Interactive CLI**: User-friendly commands for managing documentation
- 👀 **Local Viewer**: Web-based viewer for browsing documentation tree and token usage
- 📊 **Token Tracking**: Monitor LLM token usage across all CodeAtlas operations
- 🔌 **Cursor Integration**: Optional Cursor IDE rule for automatic documentation updates

## 🚀 Quick Start

### Installation

```bash
npm install -g codeatlas
```

### First Steps

1. **Initialize documentation in your project:**
   ```bash
   cd your-project
   ai-docs init
   ```

2. **Set up your OpenAI API key** (required for AI features):
   ```bash
   export OPENAI_API_KEY=your_key_here
   ```

3. **View your documentation:**
   ```bash
   ai-docs dev
   ```
   Open `http://localhost:3000` in your browser.

## 📖 Documentation

### Commands

#### `ai-docs init`

Initialize CodeAtlas documentation structure in your project.

```bash
ai-docs init
```

**Options:**
- `--cursor`: Install Cursor rule template for automatic documentation updates

**What it does:**
- Creates `.ai-docs/docs/` and `.ai-docs/docs/modules/` directories
- Copies template documentation files
- Scans your codebase and suggests modules (if code exists)
- Optionally installs Cursor rule

**Example:**
```bash
ai-docs init --cursor
```

#### `ai-docs add-module`

Add a new module to your documentation interactively.

```bash
ai-docs add-module
```

You'll be prompted for:
- Module name
- Module ID (slug)
- Parent ID (default: "root")
- Whether to auto-generate content using AI

#### `ai-docs scan`

Scan documentation files and build the `ai-tree.json` structure file.

```bash
ai-docs scan
```

Run this after adding or modifying documentation files to update the tree structure.

#### `ai-docs dev`

Start the local documentation viewer server.

```bash
ai-docs dev
```

**Options:**
- `--port <number>`: Port to run the server on (default: 3000)

**Example:**
```bash
ai-docs dev --port 8080
```

The viewer shows:
- Documentation tree (collapsible)
- Token usage statistics
- Module relationships

## 📁 Project Structure

After running `ai-docs init`, your project will have:

```
your-project/
├── .ai-docs/
│   ├── docs/
│   │   ├── ai-index.md          # Project overview
│   │   ├── ai-rules.md          # AI assistant guidelines
│   │   ├── ai-decisions.md      # Architecture decision records
│   │   ├── ai-changelog.md      # Change log
│   │   ├── modules/
│   │   │   └── <module-id>.md   # Module documentation
│   │   └── ai-tree.json         # Generated tree structure
│   └── usage.json               # Token usage tracking
```

## 📝 Documentation Format

Each `.md` file must include YAML frontmatter:

```yaml
---
id: unique-id
title: Human Readable Title
parent: parent-id-or-null
order: 10
---

Your markdown content here...
```

### Frontmatter Fields

- **`id`** (required): Unique identifier for the document
- **`title`** (required): Human-readable title
- **`parent`** (optional): ID of parent document (use `null` for root-level)
- **`order`** (optional): Numeric order for sorting (default: 0)

## 🔑 Configuration

### Environment Variables

- **`OPENAI_API_KEY`**: Required for AI-powered features. Get your key from [OpenAI](https://platform.openai.com/api-keys).

```bash
export OPENAI_API_KEY=sk-...
```

Or add to your `.env` file (make sure it's in `.gitignore`).

### Cursor Rule

The Cursor rule (`codeatlas.mdc`) instructs Cursor to:
- Read project documentation before editing code
- Update documentation after making changes
- Respect architecture decisions
- Follow coding guidelines

Install it with:
```bash
ai-docs init --cursor
```

The rule will be placed at `.cursor/rules/codeatlas.mdc`.

## 💡 Use Cases

### New Project

1. Start your project
2. Run `ai-docs init --cursor`
3. Let CodeAtlas suggest modules based on your code structure
4. Review and approve suggested modules
5. AI generates initial documentation for each module

### Existing Project

1. Run `ai-docs init`
2. CodeAtlas scans your codebase
3. Review suggested modules
4. Add additional modules as needed with `ai-docs add-module`
5. Run `ai-docs scan` to build the tree
6. View documentation with `ai-docs dev`

### Maintaining Documentation

- Run `ai-docs scan` after adding/modifying documentation
- Use `ai-docs add-module` to add new modules
- The Cursor rule (if installed) will automatically update docs when you make code changes

## 🔍 Token Usage Tracking

CodeAtlas automatically tracks LLM token usage for all AI operations. Usage data is stored in `.ai-docs/usage.json` and includes:

- **Totals**: Overall token usage
- **By Command**: Usage broken down by CLI command
- **By Category**: Usage broken down by operation category

View token usage in the viewer UI (`ai-docs dev`) or check `.ai-docs/usage.json` directly.

## 🐛 Troubleshooting

### "OPENAI_API_KEY environment variable is required"

Make sure you've set the OpenAI API key:
```bash
export OPENAI_API_KEY=your_key_here
```

### ".ai-docs/docs/ directory does not exist"

Run `ai-docs init` first to set up the documentation structure.

### "No markdown files found"

Make sure you have documentation files in `.ai-docs/docs/`. Run `ai-docs init` to create template files.

### Port already in use

Use a different port:
```bash
ai-docs dev --port 8080
```

### Command not found after installation

If `ai-docs` command is not found after global installation:
- Make sure npm's global bin directory is in your PATH
- Try: `npm config get prefix` and add that path to your PATH
- Or use: `npx codeatlas` instead

## 📄 License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE) file for details.

Personal use is permitted. Commercial use, distribution, modification, or sale requires express written permission from Ori Lerman. For permission requests, contact: lermanori@gmail.com

## 🙏 Acknowledgments

CodeAtlas is designed to improve the experience of AI-assisted development by providing structured, maintainable documentation that AI assistants can understand and use effectively.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/lermanori/codeatlas/issues)
- **Documentation**: See the project README for development information

---

**Made with ❤️ for developers who love AI-assisted coding**

