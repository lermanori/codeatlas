import { mkdir, copyFile, writeFile, readFile, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename, relative, extname } from 'path';
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

interface DirectoryNode {
  path: string;
  relativePath: string;
  files: string[];
  children: DirectoryNode[];
  parent?: DirectoryNode;
}

interface FileDocumentation {
  id: string;
  title: string;
  path: string;
  parentId: string | null;
  order: number;
}

/**
 * Check if a file should be documented
 */
function shouldDocumentFile(filePath: string): boolean {
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
  const configFiles = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'jsconfig.json',
    '.env.example',
    'docker-compose.yml',
    'docker-compose.yaml',
    'README.md',
    'Dockerfile',
    '.gitignore',
    '.npmrc',
    '.nvmrc',
    'yarn.lock',
    'pnpm-lock.yaml'
  ];
  
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);
  
  // Check code extensions
  if (codeExtensions.includes(ext)) {
    return true;
  }
  
  // Check config files
  if (configFiles.includes(fileName)) {
    return true;
  }
  
  return false;
}

/**
 * Generate a sanitized ID from a file path
 */
function generateFileId(filePath: string): string {
  // Remove extension and sanitize
  const withoutExt = filePath.replace(/\.[^/.]+$/, '');
  return withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'file';
}

/**
 * Generate a sanitized ID from a folder path
 */
function generateFolderId(folderPath: string): string {
  if (!folderPath || folderPath === '.' || folderPath === '') {
    return 'project-root';
  }
  const id = folderPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return id || 'folder';
}

/**
 * Build directory tree structure from file list
 */
function buildDirectoryTree(files: string[], root: string): DirectoryNode {
  const rootNode: DirectoryNode = {
    path: root,
    relativePath: '',
    files: [],
    children: []
  };
  
  const nodeMap = new Map<string, DirectoryNode>();
  nodeMap.set('', rootNode);
  
  // Process all files
  for (const file of files) {
    const fileDir = dirname(file);
    const fileName = basename(file);
    
    // Ensure directory path exists in tree
    const dirParts = fileDir === '.' ? [] : fileDir.split('/').filter(p => p);
    let currentPath = '';
    let currentNode = rootNode;
    
    for (const part of dirParts) {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!nodeMap.has(nextPath)) {
        const newNode: DirectoryNode = {
          path: join(root, nextPath),
          relativePath: nextPath,
          files: [],
          children: [],
          parent: currentNode
        };
        nodeMap.set(nextPath, newNode);
        currentNode.children.push(newNode);
      }
      
      currentNode = nodeMap.get(nextPath)!;
      currentPath = nextPath;
    }
    
    // Add file to current directory
    currentNode.files.push(file);
  }
  
  return rootNode;
}

/**
 * Get all files in a directory tree (for bottom-up processing)
 */
function getAllFilesInOrder(node: DirectoryNode): Array<{node: DirectoryNode, file: string}> {
  const result: Array<{node: DirectoryNode, file: string}> = [];
  
  function traverse(n: DirectoryNode) {
    // Process children first (deeper levels)
    for (const child of n.children) {
      traverse(child);
    }
    // Then process files in this node
    for (const file of n.files) {
      result.push({ node: n, file });
    }
  }
  
  traverse(node);
  return result;
}

/**
 * Get all folders in order (for bottom-up processing)
 */
function getAllFoldersInOrder(node: DirectoryNode): DirectoryNode[] {
  const result: DirectoryNode[] = [];
  
  function traverse(n: DirectoryNode) {
    // Process children first (deeper levels)
    for (const child of n.children) {
      traverse(child);
      result.push(child);
    }
  }
  
  traverse(node);
  return result;
}

/**
 * Generate documentation for a single file
 */
async function generateFileDocumentation(
  filePath: string,
  root: string,
  parentNode: DirectoryNode
): Promise<FileDocumentation> {
  const fullPath = join(root, filePath);
  const fileContent = await readFile(fullPath, 'utf-8');
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);
  
  const isConfig = !['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'].includes(ext);
  const fileType = isConfig ? 'config' : 'code';
  
  // Limit content size for LLM (first 5000 chars for code, full for config)
  const contentPreview = isConfig 
    ? fileContent 
    : fileContent.split('\n').slice(0, 200).join('\n') + (fileContent.length > 5000 ? '\n... (truncated)' : '');
  
  const prompt = `You are documenting a source file for an AI assistant. Generate comprehensive markdown documentation.

File: ${filePath}
Type: ${fileType}
Content:
\`\`\`
${contentPreview}
\`\`\`

Generate markdown that includes:
1. **Purpose**: What this file does
2. **Key Components**: Main exports, functions, classes, or configuration
3. **Dependencies**: What it imports/uses or depends on
4. **Usage**: How it's used in the project
5. **Important Notes**: Any special considerations

Format as clean markdown without frontmatter (that will be added separately).`;

  const response = await callLLM({
    command: 'init',
    category: 'init.file-docs',
    messages: [
      {
        role: 'system',
        content: 'You are a technical documentation expert. Generate clear, concise file documentation for AI assistants.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const content = response.choices[0]?.message?.content || `# ${fileName}\n\nDocumentation for ${filePath}`;
  
  // Generate IDs
  const fileId = generateFileId(filePath);
  const parentId = parentNode.relativePath ? generateFolderId(parentNode.relativePath) : 'project-root';
  
  // Create frontmatter
  const frontmatter = `---
id: ${fileId}
title: ${fileName}
parent: ${parentId}
order: 0
path: .ai-docs/files/${filePath}.md
---

`;
  
  // Save file
  const docPath = join(root, '.ai-docs', 'files', `${filePath}.md`);
  await ensureDir(dirname(docPath));
  await writeFile(docPath, frontmatter + content, 'utf-8');
  
  return {
    id: fileId,
    title: fileName,
    path: `.ai-docs/files/${filePath}.md`,
    parentId: parentId === 'root' ? null : parentId,
    order: 0
  };
}

/**
 * Generate documentation for a folder
 */
async function generateFolderDocumentation(
  node: DirectoryNode,
  root: string,
  childDocs: Array<{path: string, title: string, type: 'file'|'folder', summary?: string}>
): Promise<FileDocumentation> {
  const folderName = node.relativePath ? basename(node.relativePath) : 'Project Root';
  const folderId = generateFolderId(node.relativePath);
  const parentId = node.parent 
    ? (node.parent.relativePath ? generateFolderId(node.parent.relativePath) : 'project-root')
    : null;
  
  // Build children list
  const childrenList = childDocs.map(child => {
    const summary = child.summary ? ` - ${child.summary.substring(0, 100)}...` : '';
    return `- **${child.title}** (${child.type})${summary}`;
  }).join('\n');
  
  const prompt = `You are documenting a directory/folder for an AI assistant. Generate a summary markdown.

Folder: ${node.relativePath || 'Project Root'}
Contains:
${childrenList}

Generate markdown that includes:
1. **Purpose**: What this folder contains and its role in the project
2. **Structure**: Overview of organization and how files/folders are organized
3. **Key Files**: Important files and their roles
4. **Relationships**: How files/folders relate to each other

Include references to child files/folders. Format as clean markdown without frontmatter.`;

  const response = await callLLM({
    command: 'init',
    category: 'init.folder-docs',
    messages: [
      {
        role: 'system',
        content: 'You are a technical documentation expert. Generate clear, concise folder documentation for AI assistants.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const content = response.choices[0]?.message?.content || `# ${folderName}\n\nDocumentation for ${node.relativePath || 'project root'}`;
  
  // Create frontmatter
  const frontmatter = `---
id: ${folderId}
title: ${folderName}
parent: ${parentId || 'null'}
order: 0
path: .ai-docs/files/${node.relativePath ? node.relativePath + '/README.md' : 'README.md'}
---

`;
  
  // Save folder README
  const docPath = join(root, '.ai-docs', 'files', node.relativePath || '', 'README.md');
  await ensureDir(dirname(docPath));
  await writeFile(docPath, frontmatter + content, 'utf-8');
  
  return {
    id: folderId,
    title: folderName,
    path: `.ai-docs/files/${node.relativePath ? node.relativePath + '/README.md' : 'README.md'}`,
    parentId,
    order: 0
  };
}

/**
 * Process directory tree bottom-up (files first, then folders, then root)
 */
async function processBottomUp(
  tree: DirectoryNode,
  root: string
): Promise<FileDocumentation[]> {
  const allDocs: FileDocumentation[] = [];
  const fileDocs = new Map<string, FileDocumentation>();
  const folderDocs = new Map<string, FileDocumentation>();
  
  // Step 1: Process all files (deepest first)
  const filesInOrder = getAllFilesInOrder(tree);
  console.log(`\nProcessing ${filesInOrder.length} files...`);
  
  for (let i = 0; i < filesInOrder.length; i++) {
    const { node, file } = filesInOrder[i];
    process.stdout.write(`  Processing file ${i + 1}/${filesInOrder.length}: ${file}\r`);
    
    try {
      const doc = await generateFileDocumentation(file, root, node);
      fileDocs.set(file, doc);
      allDocs.push(doc);
    } catch (err) {
      console.error(`\n  ⚠ Error processing ${file}: ${err}`);
    }
  }
  console.log(`\n  ✓ Processed ${filesInOrder.length} files\n`);
  
  // Step 2: Process all folders (deepest first)
  const foldersInOrder = getAllFoldersInOrder(tree);
  console.log(`Processing ${foldersInOrder.length} folders...`);
  
  for (let i = 0; i < foldersInOrder.length; i++) {
    const folder = foldersInOrder[i];
    process.stdout.write(`  Processing folder ${i + 1}/${foldersInOrder.length}: ${folder.relativePath || 'root'}\r`);
    
    try {
      // Collect child documentation
      const childDocs: Array<{path: string, title: string, type: 'file'|'folder', summary?: string}> = [];
      
      // Add child files
      for (const file of folder.files) {
        const fileDoc = fileDocs.get(file);
        if (fileDoc) {
          childDocs.push({
            path: fileDoc.path,
            title: fileDoc.title,
            type: 'file'
          });
        }
      }
      
      // Add child folders
      for (const childFolder of folder.children) {
        const folderDoc = folderDocs.get(childFolder.relativePath);
        if (folderDoc) {
          childDocs.push({
            path: folderDoc.path,
            title: folderDoc.title,
            type: 'folder'
          });
        }
      }
      
      const doc = await generateFolderDocumentation(folder, root, childDocs);
      folderDocs.set(folder.relativePath, doc);
      allDocs.push(doc);
    } catch (err) {
      console.error(`\n  ⚠ Error processing folder ${folder.relativePath}: ${err}`);
    }
  }
  console.log(`\n  ✓ Processed ${foldersInOrder.length} folders\n`);
  
  // Step 3: Process root
  if (tree.relativePath === '') {
    console.log('Processing root...');
    try {
      const childDocs: Array<{path: string, title: string, type: 'file'|'folder'}> = [];
      
      // Add root files
      for (const file of tree.files) {
        const fileDoc = fileDocs.get(file);
        if (fileDoc) {
          childDocs.push({
            path: fileDoc.path,
            title: fileDoc.title,
            type: 'file'
          });
        }
      }
      
      // Add top-level folders
      for (const childFolder of tree.children) {
        const folderDoc = folderDocs.get(childFolder.relativePath);
        if (folderDoc) {
          childDocs.push({
            path: folderDoc.path,
            title: folderDoc.title,
            type: 'folder'
          });
        }
      }
      
      const rootDoc = await generateFolderDocumentation(tree, root, childDocs);
      allDocs.push(rootDoc);
      console.log('  ✓ Processed root\n');
    } catch (err) {
      console.error(`\n  ⚠ Error processing root: ${err}`);
    }
  }
  
  return allDocs;
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
  await ensureDir(join(root, '.ai-docs', 'files'));
  console.log('  ✓ Created .ai-docs/docs/, .ai-docs/docs/modules/, and .ai-docs/files/\n');

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

  // 4. Detect code and generate recursive documentation
  const hasCode = await hasExistingCode(root);
  
  if (!hasCode) {
    console.log('No existing code detected. Skipping documentation generation.\n');
  } else {
    console.log('Existing code detected. Generating recursive documentation tree...\n');

    // 4. Scan files
    console.log('Scanning project files...');
    const allFiles = await scanProject(root);
    console.log(`  ✓ Found ${allFiles.length} files\n`);

    // 5. Filter to files that should be documented
    const filesToDocument = allFiles.filter(shouldDocumentFile);
    console.log(`  ✓ ${filesToDocument.length} files will be documented (code + config files)\n`);

    if (filesToDocument.length === 0) {
      console.log('No files to document found.\n');
    } else {
      // 6. Build directory tree
      console.log('Building directory tree structure...');
      const directoryTree = buildDirectoryTree(filesToDocument, root);
      console.log('  ✓ Directory tree built\n');

      // 7. Process bottom-up (files → folders → root)
      const allDocs = await processBottomUp(directoryTree, root);

      // 8. Run scan to build ai-tree.json
      console.log('Building documentation tree (ai-tree.json)...');
      try {
        const scanModule = await import('./scan.js');
        // Scan will automatically find all .md files in .ai-docs/docs and .ai-docs/files
        await scanModule.handleScan({ 
          analyzeCode: false, 
          suggestOnly: false, 
          autoLink: false 
        });
        console.log('  ✓ Documentation tree built\n');
      } catch (err: any) {
        console.warn(`  ⚠ Warning: Could not build ai-tree.json: ${err?.message || err}`);
        console.log('  You can run `ai-docs scan` manually to build the tree.\n');
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
    const filesDir = join(root, '.ai-docs', 'files');
    let fileCount = 0;
    try {
      if (existsSync(filesDir)) {
        // Count all .md files recursively
        async function countFiles(dir: string): Promise<number> {
          let count = 0;
          try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = join(dir, entry.name);
              if (entry.isDirectory()) {
                count += await countFiles(fullPath);
              } else if (entry.isFile() && entry.name.endsWith('.md')) {
                count++;
              }
            }
          } catch {
            // Ignore errors
          }
          return count;
        }
        fileCount = await countFiles(filesDir);
      }
    } catch {
      // Ignore errors
    }
    console.log(`  - Files documented: ${fileCount}`);
  }
  console.log(`  - Token usage: ${initUsage.total_tokens} tokens (${initUsage.prompt_tokens} prompt + ${initUsage.completion_tokens} completion)`);
  console.log('\nNext steps:');
  console.log('  - Run `ai-docs scan` to update the documentation tree');
  console.log('  - Run `ai-docs dev` to view your documentation');
}

