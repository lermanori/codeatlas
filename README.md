# CodeAtlas - Development

> AI-readable documentation generator for code projects

This is the development repository for CodeAtlas. For user documentation and installation instructions, see [USER_README.md](USER_README.md).

## Overview

CodeAtlas is a developer tool that generates and maintains an **AI-readable documentation system** for any code project. It includes a structured `.ai-docs/docs/` folder using Markdown + frontmatter, a CLI tool, a local viewer UI, and automated module generation based on scanning your project.

The system helps AI assistants (Cursor, ChatGPT, Claude, etc.) understand your project architecture and maintain documentation automatically.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd codeAtlas

# Install dependencies
npm install
```

### Building

```bash
# Build the project
npm run build
```

This will:
- Compile TypeScript to JavaScript in `dist/`
- Copy templates to `dist/templates/`
- Copy viewer files to `dist/viewer/`
- Generate TypeScript declaration files

### Running in Development

```bash
# Run directly with ts-node (no build needed)
npm run dev
```

Or run the built version:

```bash
# Build first
npm run build

# Then run
npm start
```

### Testing Commands Locally

After building, you can test the CLI locally:

```bash
# Link globally for testing
npm link

# Now you can use ai-docs command
ai-docs --help
```

Or test without linking:

```bash
node dist/index.js --help
```

## Project Structure

```
codeAtlas/
├── src/
│   ├── commands/        # CLI command handlers
│   │   ├── init.ts      # Initialize documentation
│   │   ├── addModule.ts # Add new module
│   │   ├── scan.ts      # Scan and build tree
│   │   └── dev.ts       # Development server
│   ├── utils/           # Utility functions
│   │   ├── fileScanner.ts
│   │   ├── frontmatterParser.ts
│   │   ├── usageLogger.ts
│   │   └── ...
│   ├── llm/             # LLM client wrapper
│   │   ├── llmClient.ts
│   │   └── index.ts
│   ├── templates/       # Documentation templates
│   │   ├── codeatlas-rule.mdc
│   │   └── docs/
│   ├── viewer/          # Viewer UI files
│   │   ├── index.html
│   │   ├── style.css
│   │   └── viewer.js
│   └── index.ts         # CLI entry point
├── dist/                # Compiled output
├── docs/                # Project documentation
│   ├── ai-index.md
│   ├── ai-rules.md
│   ├── ai-decisions.md
│   ├── ai-changelog.md
│   └── modules/
└── package.json
```

## Development Workflow

### Making Changes

1. Make your changes in `src/`
2. Run `npm run build` to compile
3. Test your changes with `npm run dev` or `npm start`
4. Update documentation if needed

### Adding New Commands

1. Create a new file in `src/commands/`
2. Export a handler function
3. Register the command in `src/index.ts`
4. Update documentation

### Adding New Utilities

1. Add utility functions in `src/utils/`
2. Export from `src/utils/index.ts` if needed
3. Update TypeScript types if necessary

## Publishing

### Pre-Publish Checklist

- [ ] Update version in `package.json`
- [ ] Run `npm run build` to ensure latest code is compiled
- [ ] Test with `npm pack --dry-run` to verify package contents
- [ ] Update `CHANGELOG.md` with new version
- [ ] Verify all tests pass (if applicable)

### Publishing Steps

```bash
# Build the project
npm run build

# Test the package (dry-run)
npm pack --dry-run

# If everything looks good, publish
npm publish
```

Note: The `prepublishOnly` script will automatically run `npm run build` before publishing.

## Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Style

- Use TypeScript with strict mode enabled
- Follow existing code patterns
- Add comments for complex logic
- Update documentation for user-facing changes

## License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE) file for details.

Personal use is permitted. Commercial use, distribution, modification, or sale requires express written permission from Ori Lerman.

## Support

For user support, see [USER_README.md](USER_README.md).

For development questions or issues, please open an issue on the repository.

