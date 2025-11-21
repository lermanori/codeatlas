import { writeFile, readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';
import { scanProject } from '../utils/fileScanner.js';
import { callLLM } from '../llm/llmClient.js';
import { ensureApiKey } from '../utils/apiKeyPrompt.js';
import OpenAI from 'openai';

interface AddModuleOptions {
  // No options for now, all interactive
}

/**
 * Generate module ID from name (slug format)
 */
function generateIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Find files related to a module
 */
function findRelatedFiles(files: string[], moduleName: string, moduleId: string): string[] {
  const keywords = [
    moduleId.toLowerCase(),
    ...moduleName.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  ];

  return files.filter(file => {
    const lower = file.toLowerCase();
    return keywords.some(keyword => lower.includes(keyword));
  }).slice(0, 20); // Limit to 20 files
}

/**
 * Generate module documentation using LLM
 */
async function generateModuleDoc(
  moduleName: string,
  moduleId: string,
  relatedFiles: string[]
): Promise<string> {
  const fileList = relatedFiles.length > 0
    ? relatedFiles.slice(0, 15).map(f => `- ${f}`).join('\n')
    : 'No specific files identified';

  // Read and include code snippets from key files for context
  let codeContext = '';
  const root = process.cwd();
  const keyFiles = relatedFiles.slice(0, 5); // Limit to 5 files for context
  for (const file of keyFiles) {
    try {
      const fullPath = join(root, file);
      if (existsSync(fullPath)) {
        const content = await readFile(fullPath, 'utf-8');
        // Include first 50 lines or first 2000 chars, whichever is smaller
        const preview = content.split('\n').slice(0, 50).join('\n');
        if (preview.length > 2000) {
          codeContext += `\n\nFile: ${file}\n\`\`\`\n${preview.substring(0, 2000)}...\n\`\`\`\n`;
        } else {
          codeContext += `\n\nFile: ${file}\n\`\`\`\n${preview}\n\`\`\`\n`;
        }
      }
    } catch (err) {
      // Skip files that can't be read
    }
  }

  const prompt = `You are documenting a code module for an AI assistant. Generate comprehensive module documentation.

Module Information:
- Name: ${moduleName}
- ID: ${moduleId}

Related Files:
${fileList}
${codeContext ? `\nCode Context from key files:${codeContext}` : ''}

IMPORTANT: When interpreting acronyms or abbreviations in module names, analyze the actual code context provided above. For example, "LLM" in a codebase dealing with OpenAI, GPT models, or language models should be interpreted as "Large Language Model", not other possible meanings.

Generate markdown documentation that includes:
1. **Purpose**: Clear description of what this module does (use the code context to understand the actual purpose)
2. **Key Files**: List and describe the important files in this module
3. **Important Entities/Types**: Document key classes, interfaces, types, or data structures
4. **Constraints/Invariants**: Document any important constraints, invariants, or rules
5. **Common Patterns**: Describe common usage patterns or conventions

Format the output as clean markdown without frontmatter (that will be added separately).`;

  const response = await callLLM({
    command: 'add-module',
    category: 'add-module.doc',
    messages: [
      {
        role: 'system',
        content: 'You are a technical documentation expert. Generate clear, concise module documentation for AI assistants.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  return response.choices[0]?.message?.content || `# ${moduleName}\n\n## Purpose\n\nThis module handles ${moduleName.toLowerCase()}.\n\n## Key Files\n\n${fileList}\n\n## TODO\n\nAdd detailed documentation for this module.`;
}

/**
 * Get next order number for a module
 */
async function getNextOrder(root: string, parentId: string): Promise<number> {
  const modulesDir = join(root, '.ai-docs', 'docs', 'modules');
  if (!existsSync(modulesDir)) {
    return 10;
  }

  try {
    const files = await readdir(modulesDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    // For simplicity, just return a high order number
    // In a more sophisticated version, we could parse existing modules
    return (mdFiles.length + 1) * 10;
  } catch {
    return 10;
  }
}

/**
 * Main add-module command handler
 */
export async function handleAddModule(options: AddModuleOptions): Promise<void> {
  const root = process.cwd();
  console.log('Adding a new module to CodeAtlas documentation...\n');

  // Check if .ai-docs/docs/modules exists
  const modulesDir = join(root, '.ai-docs', 'docs', 'modules');
  if (!existsSync(join(root, '.ai-docs', 'docs'))) {
    console.error('Error: .ai-docs/docs/ directory does not exist. Run `ai-docs init` first.');
    process.exit(1);
  }

  if (!existsSync(modulesDir)) {
    const { mkdir } = await import('fs/promises');
    await mkdir(modulesDir, { recursive: true });
  }

  // 1. Interactive prompts
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'moduleName',
      message: 'Module Name (human-readable):',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Module name cannot be empty';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'moduleId',
      message: 'Module ID (slug, e.g., "crm"):',
      default: (answers: any) => generateIdFromName(answers.moduleName || ''),
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Module ID cannot be empty';
        }
        if (/\s/.test(input)) {
          return 'Module ID cannot contain spaces';
        }
        if (!/^[a-z0-9-]+$/.test(input)) {
          return 'Module ID must be lowercase alphanumeric with hyphens only';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'parentId',
      message: 'Parent ID (default: "root"):',
      default: 'root'
    },
    {
      type: 'confirm',
      name: 'autoGenerate',
      message: 'Auto-generate content using AI?',
      default: true
    }
  ]);

  const { moduleName, moduleId, parentId, autoGenerate } = answers;

  // Check for duplicate
  const modulePath = join(modulesDir, `${moduleId}.md`);
  if (existsSync(modulePath)) {
    const overwrite = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Module "${moduleId}" already exists. Overwrite?`,
        default: false
      }
    ]);

    if (!overwrite.overwrite) {
      console.log('\nCancelled. Module not created.');
      return;
    }
  }

  // 2. Find related files
  console.log('\nScanning for related files...');
  const allFiles = await scanProject(root);
  const relatedFiles = findRelatedFiles(allFiles, moduleName, moduleId);
  console.log(`  ✓ Found ${relatedFiles.length} related files`);

  // 3. Generate content
  let content: string;
  if (autoGenerate) {
    // Check for API key before making LLM calls
    await ensureApiKey();
    
    console.log('\nGenerating module documentation with AI...');
    try {
      content = await generateModuleDoc(moduleName, moduleId, relatedFiles);
      console.log('  ✓ Generated documentation');
    } catch (error: any) {
      console.warn(`  ⚠ Warning: AI generation failed: ${error.message}`);
      console.log('  Falling back to placeholder content');
      content = `# ${moduleName}\n\n## Purpose\n\nThis module handles ${moduleName.toLowerCase()}.\n\n## Key Files\n\n${relatedFiles.length > 0 ? relatedFiles.map(f => `- ${f}`).join('\n') : 'No specific files identified'}\n\n## TODO\n\nAdd detailed documentation for this module.`;
    }
  } else {
    content = `# ${moduleName}\n\n## Purpose\n\nThis module handles ${moduleName.toLowerCase()}.\n\n## Key Files\n\n${relatedFiles.length > 0 ? relatedFiles.map(f => `- ${f}`).join('\n') : 'No specific files identified'}\n\n## TODO\n\nAdd detailed documentation for this module.`;
  }

  // 4. Get order
  const order = await getNextOrder(root, parentId);

  // 5. Create module file
  const frontmatter = `---
id: ${moduleId}
title: ${moduleName}
parent: ${parentId}
order: ${order}
---

`;

  await writeFile(modulePath, frontmatter + content, 'utf-8');
  console.log(`\n✓ Created module: .ai-docs/docs/modules/${moduleId}.md`);

  // 6. Post-creation
  console.log('\nNext steps:');
  console.log('  - Run `ai-docs scan` to update the documentation tree');
  console.log('  - Run `ai-docs dev` to view your documentation');
}

