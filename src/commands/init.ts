import { mkdir, copyFile, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import { scanProject } from '../utils/fileScanner.js';
import { callLLM } from '../llm/llmClient.js';
import { loadUsage } from '../utils/usageLogger.js';
import { ensureApiKey } from '../utils/apiKeyPrompt.js';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InitOptions {
  cursor?: boolean;
}

interface ModuleSuggestion {
  id: string;
  title: string;
  description: string;
  order: number;
}

/**
 * Check if project has existing code by recursively scanning for code files
 */
async function hasExistingCode(root: string): Promise<boolean> {
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
  
  try {
    // Scan the entire project for code files
    const allFiles = await scanProject(root);
    
    // Check if any files have code extensions
    for (const file of allFiles) {
      const ext = file.substring(file.lastIndexOf('.'));
      if (codeExtensions.includes(ext)) {
        return true;
      }
    }
  } catch (err) {
    // If scanning fails, fall back to checking common directories
    const codeDirs = ['src', 'apps', 'packages', 'server', 'lib', 'backend', 'frontend'];
    for (const dir of codeDirs) {
      if (existsSync(join(root, dir))) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Ensure directory exists, create if missing
 */
async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

/**
 * Copy template file if it doesn't exist
 */
async function copyTemplateIfMissing(
  templatePath: string,
  destPath: string,
  templateName: string
): Promise<boolean> {
  if (existsSync(destPath)) {
    console.log(`  ✓ ${templateName} already exists, skipping`);
    return false;
  }

  // Get template from dist (after build) or src (during dev)
  const templateBase = join(__dirname, '..', 'templates', 'docs');
  const templateFullPath = join(templateBase, templateName);
  
  // Fallback to src if not in dist
  const srcTemplatePath = join(process.cwd(), 'src', 'templates', 'docs', templateName);
  const finalTemplatePath = existsSync(templateFullPath) ? templateFullPath : srcTemplatePath;

  if (!existsSync(finalTemplatePath)) {
    console.warn(`  ⚠ Warning: Template ${templateName} not found at ${finalTemplatePath}`);
    return false;
  }

  await copyFile(finalTemplatePath, destPath);
  console.log(`  ✓ Created ${templateName}`);
  return true;
}

/**
 * Build project summary for LLM
 */
function buildProjectSummary(files: string[]): string {
  // Filter to code files
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
  const codeFiles = files.filter(f => codeExtensions.some(ext => f.endsWith(ext)));

  // Extract directory structure
  const dirs = new Set<string>();
  codeFiles.forEach(file => {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  });

  // Count files by type
  const fileCounts: Record<string, number> = {};
  codeFiles.forEach(file => {
    const ext = file.substring(file.lastIndexOf('.'));
    fileCounts[ext] = (fileCounts[ext] || 0) + 1;
  });

  // Extract domain keywords
  const keywords = new Set<string>();
  const domainKeywords = ['auth', 'user', 'billing', 'crm', 'payment', 'invoice', 'order', 'product', 'cart', 'admin', 'api', 'db', 'database'];
  
  files.forEach(file => {
    const lower = file.toLowerCase();
    domainKeywords.forEach(keyword => {
      if (lower.includes(keyword)) {
        keywords.add(keyword);
      }
    });
  });

  return `Project Structure:
- Total code files: ${codeFiles.length}
- File types: ${Object.entries(fileCounts).map(([ext, count]) => `${ext}: ${count}`).join(', ')}
- Top-level directories: ${Array.from(dirs).slice(0, 10).join(', ')}
- Domain keywords found: ${Array.from(keywords).join(', ')}

Sample files:
${codeFiles.slice(0, 20).map(f => `- ${f}`).join('\n')}
${codeFiles.length > 20 ? `... and ${codeFiles.length - 20} more files` : ''}`;
}

/**
 * Parse LLM response for module suggestions
 */
function parseModuleSuggestions(response: OpenAI.Chat.Completions.ChatCompletion): ModuleSuggestion[] {
  const content = response.choices[0]?.message?.content || '';
  
  // Try to parse as JSON first
  try {
    // Look for JSON in the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((m: any, idx: number) => ({
          id: m.id || m.module_id || `module-${idx + 1}`,
          title: m.title || m.name || m.module_title || `Module ${idx + 1}`,
          description: m.description || m.desc || '',
          order: m.order || (idx + 1) * 10
        }));
      }
    }
  } catch (err) {
    // Fall through to text parsing
  }

  // Fallback: try to parse structured text
  const modules: ModuleSuggestion[] = [];
  const lines = content.split('\n');
  let currentModule: Partial<ModuleSuggestion> | null = null;

  for (const line of lines) {
    if (line.match(/^\d+\.|^[-*]/)) {
      if (currentModule) {
        modules.push({
          id: currentModule.id || `module-${modules.length + 1}`,
          title: currentModule.title || `Module ${modules.length + 1}`,
          description: currentModule.description || '',
          order: currentModule.order || (modules.length + 1) * 10
        });
      }
      currentModule = {
        title: line.replace(/^\d+\.|^[-*]\s*/, '').trim(),
        order: (modules.length + 1) * 10
      };
    } else if (line.toLowerCase().includes('id:') && currentModule) {
      currentModule.id = line.split(':')[1]?.trim() || '';
    } else if (line.toLowerCase().includes('description:') && currentModule) {
      currentModule.description = line.split(':').slice(1).join(':').trim();
    } else if (currentModule && line.trim()) {
      currentModule.description = (currentModule.description || '') + ' ' + line.trim();
    }
  }

  if (currentModule) {
    modules.push({
      id: currentModule.id || `module-${modules.length + 1}`,
      title: currentModule.title || `Module ${modules.length + 1}`,
      description: currentModule.description || '',
      order: currentModule.order || (modules.length + 1) * 10
    });
  }

  // Generate IDs from titles if missing
  return modules.map((m, idx) => ({
    ...m,
    id: m.id || m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `module-${idx + 1}`,
    order: m.order || (idx + 1) * 10
  }));
}

/**
 * Find files related to a module
 */
function findRelatedFiles(files: string[], module: ModuleSuggestion): string[] {
  const keywords = [
    module.id.toLowerCase(),
    ...module.title.toLowerCase().split(/\s+/),
    ...module.description.toLowerCase().split(/\s+/).filter(w => w.length > 3)
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
  module: ModuleSuggestion,
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
- ID: ${module.id}
- Title: ${module.title}
- Description: ${module.description}

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
      command: 'init',
      category: 'init.module-docs',
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

  return response.choices[0]?.message?.content || `# ${module.title}\n\n${module.description}\n\n## Purpose\n\nThis module handles ${module.title.toLowerCase()}.\n\n## Key Files\n\n${fileList}\n\n## TODO\n\nAdd detailed documentation for this module.`;
}

/**
 * Clean up previous CodeAtlas files (except .env)
 */
async function cleanupPreviousFiles(root: string): Promise<void> {
  const aiDocsPath = join(root, '.ai-docs');
  const cursorRulePath = join(root, '.cursor', 'rules', 'codeatlas.mdc');
  const envPath = join(aiDocsPath, '.env');
  
  // Save .env file if it exists
  let envContent: string | null = null;
  if (existsSync(envPath)) {
    try {
      envContent = await readFile(envPath, 'utf-8');
    } catch (err) {
      // If we can't read it, just continue without it
    }
  }
  
  // Remove .ai-docs directory if it exists
  if (existsSync(aiDocsPath)) {
    await rm(aiDocsPath, { recursive: true, force: true });
    console.log('  ✓ Removed previous .ai-docs directory');
  }
  
  // Restore .env file if it existed
  if (envContent) {
    await ensureDir(aiDocsPath);
    await writeFile(envPath, envContent, 'utf-8');
    console.log('  ✓ Preserved .ai-docs/.env file');
  }
  
  // Remove cursor rule if it exists
  if (existsSync(cursorRulePath)) {
    await rm(cursorRulePath, { force: true });
    console.log('  ✓ Removed previous Cursor rule');
  }
}

/**
 * Main init command handler
 */
export async function handleInit(options: InitOptions): Promise<void> {
  const root = process.cwd();
  console.log('Initializing CodeAtlas documentation...\n');

  // 0. Clean up previous files (except .env)
  const aiDocsExists = existsSync(join(root, '.ai-docs'));
  const cursorRuleExists = existsSync(join(root, '.cursor', 'rules', 'codeatlas.mdc'));
  
  if (aiDocsExists || cursorRuleExists) {
    console.log('Cleaning up previous files...');
    await cleanupPreviousFiles(root);
    console.log('');
  }

  // 1. Set up directories
  console.log('Setting up directories...');
  await ensureDir(join(root, '.ai-docs'));
  await ensureDir(join(root, '.ai-docs', 'docs'));
  await ensureDir(join(root, '.ai-docs', 'docs', 'modules'));
  console.log('  ✓ Created .ai-docs/docs/ and .ai-docs/docs/modules/\n');

  // 2. Check for API key (will use existing if found, prompt if missing)
  await ensureApiKey();

  // 3. Copy templates
  console.log('Copying templates...');
  const templates = ['ai-index.md', 'ai-rules.md', 'ai-decisions.md', 'ai-changelog.md'];
  let templatesCreated = 0;
  
  for (const template of templates) {
    const destPath = join(root, '.ai-docs', 'docs', template);
    if (await copyTemplateIfMissing('', destPath, template)) {
      templatesCreated++;
    }
  }
  console.log('');

  // 4. Detect code
  const hasCode = await hasExistingCode(root);
  
  if (!hasCode) {
    console.log('No existing code detected. Skipping module suggestion.\n');
  } else {
    console.log('Existing code detected. Analyzing project structure...\n');

    // 4. Scan files
    console.log('Scanning project files...');
    const allFiles = await scanProject(root);
    console.log(`  ✓ Found ${allFiles.length} files\n`);

    // 5. Build summary and get module suggestions
    console.log('Analyzing project structure and suggesting modules...');
    const summary = buildProjectSummary(allFiles);

    const suggestionPrompt = `You are analyzing a codebase to suggest logical modules for documentation.

${summary}

Suggest 3-7 modules that would help organize this codebase. For each module, provide:
- id: A short slug identifier (e.g., "auth", "billing")
- title: A human-readable title (e.g., "Authentication Module")
- description: A brief description of what this module covers
- order: A number for sorting (10, 20, 30, etc.)

Return your response as a JSON array of objects with these fields.`;

    const suggestionResponse = await callLLM({
      command: 'init',
      category: 'init.suggest-modules',
      messages: [
        {
          role: 'system',
          content: 'You are a software architecture expert. Analyze codebases and suggest logical module boundaries for documentation.'
        },
        {
          role: 'user',
          content: suggestionPrompt
        }
      ]
    });

    const suggestions = parseModuleSuggestions(suggestionResponse);
    console.log(`  ✓ Generated ${suggestions.length} module suggestions\n`);

    if (suggestions.length === 0) {
      console.log('No modules could be suggested. You can add modules later with `ai-docs add-module`.\n');
    } else {
      // 6. Interactive selection
      console.log('Module Suggestions:');
      suggestions.forEach((s, i) => {
        console.log(`\n${i + 1}. ${s.title} (${s.id})`);
        console.log(`   ${s.description}`);
      });
      console.log('');

      const answers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedModules',
          message: 'Select modules to create (use space to toggle, enter to confirm):',
          choices: suggestions.map(s => ({
            name: `${s.title} (${s.id}) - ${s.description}`,
            value: s,
            checked: true
          }))
        }
      ]);

      const selectedModules = answers.selectedModules as ModuleSuggestion[];

      if (selectedModules.length > 0) {
        // Allow editing
        const editAnswers = await inquirer.prompt(
          selectedModules.map((module, idx) => [
            {
              type: 'input',
              name: `title_${idx}`,
              message: `Edit title for "${module.title}":`,
              default: module.title
            },
            {
              type: 'input',
              name: `id_${idx}`,
              message: `Edit ID for "${module.title}" (slug format, no spaces):`,
              default: module.id,
              validate: (input: string) => {
                if (!input || input.trim().length === 0) {
                  return 'ID cannot be empty';
                }
                if (/\s/.test(input)) {
                  return 'ID cannot contain spaces';
                }
                if (!/^[a-z0-9-]+$/.test(input)) {
                  return 'ID must be lowercase alphanumeric with hyphens only';
                }
                return true;
              }
            }
          ]).flat()
        );

        // Update modules with edited values
        selectedModules.forEach((module, idx) => {
          const newTitle = editAnswers[`title_${idx}`];
          const newId = editAnswers[`id_${idx}`];
          if (newTitle) module.title = newTitle;
          if (newId) module.id = newId;
        });

        // 7. Generate module docs
        console.log('\nGenerating module documentation...');
        for (const module of selectedModules) {
          console.log(`  Generating ${module.title}...`);
          const relatedFiles = findRelatedFiles(allFiles, module);
          const content = await generateModuleDoc(module, relatedFiles);

          const frontmatter = `---
id: ${module.id}
title: ${module.title}
parent: root
order: ${module.order}
---

`;

          const modulePath = join(root, '.ai-docs', 'docs', 'modules', `${module.id}.md`);
          await writeFile(modulePath, frontmatter + content, 'utf-8');
          console.log(`    ✓ Created .ai-docs/docs/modules/${module.id}.md`);
        }
        console.log('');
      }
    }
  }

  // 8. Install Cursor rule if requested
  if (options.cursor) {
    console.log('Installing Cursor rule...');
    await ensureDir(join(root, '.cursor', 'rules'));
    
    const cursorRulePath = join(root, '.cursor', 'rules', 'codeatlas.mdc');
    if (existsSync(cursorRulePath)) {
      console.log('  ✓ Cursor rule already exists, skipping');
    } else {
      const templateBase = join(__dirname, '..', 'templates');
      const templatePath = join(templateBase, 'codeatlas-rule.mdc');
      const srcTemplatePath = join(process.cwd(), 'src', 'templates', 'codeatlas-rule.mdc');
      const finalTemplatePath = existsSync(templatePath) ? templatePath : srcTemplatePath;

      if (existsSync(finalTemplatePath)) {
        // Ask user how they want the rule to be applied
        const ruleConfigAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'ruleMode',
            message: 'How should this rule be applied?',
            choices: [
              {
                name: 'Always apply automatically - Rule will be included in all AI interactions',
                value: 'always',
                short: 'Always apply'
              },
              {
                name: 'Manual application - You will select the rule when needed',
                value: 'manual',
                short: 'Manual apply'
              }
            ],
            default: 'always'
          }
        ]);

        // Read template
        let templateContent = await readFile(finalTemplatePath, 'utf-8');

        // Conditionally add alwaysApply to frontmatter
        if (ruleConfigAnswer.ruleMode === 'always') {
          // Check if frontmatter exists
          if (templateContent.startsWith('---')) {
            // Find the end of frontmatter (second occurrence of ---)
            const frontmatterEnd = templateContent.indexOf('---', 3);
            if (frontmatterEnd !== -1) {
              const frontmatterStart = templateContent.substring(0, frontmatterEnd);
              const frontmatterEndMarker = '---';
              const body = templateContent.substring(frontmatterEnd + 3);
              
              // Check if alwaysApply already exists
              if (!frontmatterStart.includes('alwaysApply:')) {
                // Add alwaysApply: true before the closing ---
                const updatedFrontmatter = frontmatterStart + 'alwaysApply: true\n' + frontmatterEndMarker;
                templateContent = updatedFrontmatter + body;
              }
            }
          }
        }

        // Write the customized rule
        await writeFile(cursorRulePath, templateContent, 'utf-8');
        console.log('  ✓ Installed Cursor rule at .cursor/rules/codeatlas.mdc');
        if (ruleConfigAnswer.ruleMode === 'always') {
          console.log('  ✓ Rule configured to always apply automatically');
        } else {
          console.log('  ✓ Rule configured for manual application');
        }
      } else {
        console.warn('  ⚠ Warning: Cursor rule template not found');
      }
    }
    console.log('');
  }

  // 9. Completion summary
  console.log('✓ Initialization complete!\n');
  
  const usage = await loadUsage();
  const initUsage = usage.byCommand.init || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  
  console.log('Summary:');
  console.log(`  - Templates created: ${templatesCreated}`);
  if (hasCode) {
    const { readdir } = await import('fs/promises');
    const modulesDir = join(root, '.ai-docs', 'docs', 'modules');
    let moduleCount = 0;
    try {
      if (existsSync(modulesDir)) {
        const files = await readdir(modulesDir);
        moduleCount = files.filter(f => f.endsWith('.md')).length;
      }
    } catch {
      // Ignore errors
    }
    console.log(`  - Modules generated: ${moduleCount}`);
  }
  console.log(`  - Token usage: ${initUsage.total_tokens} tokens (${initUsage.prompt_tokens} prompt + ${initUsage.completion_tokens} completion)`);
  console.log('\nNext steps:');
  console.log('  - Run `ai-docs scan` to build the documentation tree');
  console.log('  - Run `ai-docs dev` to view your documentation');
  console.log('  - Run `ai-docs add-module` to add more modules');
}

