import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, dirname, basename, normalize, relative } from 'path';
import { existsSync } from 'fs';
import { parse } from '../utils/frontmatterParser.js';
import { copyAssets } from '../utils/assetCopier.js';
import { analyzeCodeStructure, suggestModuleHierarchy, mapSourceToModule, type CodeStructure, type HierarchySuggestion } from '../utils/codeStructureAnalyzer.js';

interface TreeEntry {
  id: string;
  title: string;
  parent: string | null;
  order: number;
  path: string;
  references?: string[];
  isReferenced?: boolean;
  sourceFile?: string;
  suggestedParent?: string;
  sourceFiles?: string[];
  isSourceFile?: boolean;
}

interface TreeData {
  [id: string]: TreeEntry;
}

interface ScanOptions {
  analyzeCode?: boolean;
  suggestOnly?: boolean;
  autoLink?: boolean;
}

/**
 * Recursively find all .md files in a directory
 */
async function findMarkdownFiles(dir: string, root: string): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stats = await stat(fullPath);
      
      if (stats.isDirectory()) {
        const subFiles = await findMarkdownFiles(fullPath, root);
        files.push(...subFiles);
      } else if (stats.isFile() && entry.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.warn(`Warning: Could not read directory ${dir}: ${err}`);
  }
  
  return files;
}

/**
 * Extract markdown file references from content
 */
function extractMarkdownReferences(content: string, currentDir: string, root: string): string[] {
  const references: string[] = [];
  // Match markdown links: [text](path/to/file.md)
  const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
  let match;
  
  while ((match = linkRegex.exec(content)) !== null) {
    const linkPath = match[2];
    // Skip external URLs
    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
      continue;
    }
    
    // Resolve relative paths
    let resolvedPath: string;
    if (linkPath.startsWith('/')) {
      // Absolute from root
      resolvedPath = join(root, linkPath.slice(1));
    } else {
      // Relative to current file
      resolvedPath = join(currentDir, linkPath);
    }
    
    // Normalize path
    resolvedPath = normalize(resolvedPath);
    
    // Check if file exists and is within docs or files directory
    const docsDir = normalize(join(root, '.ai-docs', 'docs'));
    const filesDir = normalize(join(root, '.ai-docs', 'files'));
    if ((resolvedPath.startsWith(docsDir) || resolvedPath.startsWith(filesDir)) && existsSync(resolvedPath)) {
      const relPath = resolvedPath.replace(root + '/', '').replace(root + '\\', '');
      if (!references.includes(relPath)) {
        references.push(relPath);
      }
    }
  }
  
  return references;
}

/**
 * Recursively find all referenced files
 */
async function findAllReferencedFiles(
  startFiles: string[],
  root: string,
  visited: Set<string> = new Set()
): Promise<Set<string>> {
  const allReferenced = new Set<string>();
  const docsDir = join(root, '.ai-docs', 'docs');
  
  async function traverse(filePath: string) {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    
    const fullPath = filePath.startsWith(root) ? filePath : join(root, filePath);
    if (!existsSync(fullPath)) return;
    
    try {
      const content = await readFile(fullPath, 'utf-8');
      const { body } = parse(content);
      const currentDir = dirname(fullPath);
      const references = extractMarkdownReferences(body, currentDir, root);
      
      for (const ref of references) {
        const refFullPath = ref.startsWith(root) ? ref : join(root, ref);
        if (existsSync(refFullPath) && !allReferenced.has(ref)) {
          allReferenced.add(ref);
          // Recursively traverse referenced files
          await traverse(ref);
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not read file ${filePath}: ${err}`);
    }
  }
  
  for (const file of startFiles) {
    await traverse(file);
  }
  
  return allReferenced;
}

/**
 * Generate ID and title for a file without frontmatter
 */
function generateEntryForReferencedFile(filePath: string, root: string): TreeEntry {
  const relPath = filePath.replace(root + '/', '').replace(root + '\\', '');
  const fileName = basename(filePath, '.md');
  // Generate a safe ID from the file path
  const id = relPath
    .replace('.ai-docs/docs/', '')
    .replace(/\.md$/, '')
    .replace(/[\/\\]/g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();
  
  // Generate title from filename (capitalize words)
  const title = fileName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return {
    id,
    title,
    parent: null, // Referenced files start as root-level
    order: 999, // Put referenced files at the end
    path: relPath,
    isReferenced: true
  };
}

/**
 * Generate entry for source file
 */
function generateEntryForSourceFile(
  sourceFile: { relativePath: string; fileName: string; suggestedModuleId: string; suggestedParentId?: string },
  root: string
): TreeEntry {
  const title = sourceFile.fileName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return {
    id: sourceFile.suggestedModuleId,
    title,
    parent: sourceFile.suggestedParentId || null,
    order: 999,
    path: '', // No doc file exists
    sourceFile: sourceFile.relativePath,
    suggestedParent: sourceFile.suggestedParentId,
    isSourceFile: true
  };
}

/**
 * Validate hierarchy for circular references
 */
function validateHierarchy(tree: TreeData): { circular: string[]; orphaned: string[] } {
  const circular: string[] = [];
  const orphaned: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function checkCircular(id: string, path: string[]): void {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(id);
        circular.push(cycle.join(' -> '));
      }
      return;
    }

    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    const entry = tree[id];
    if (!entry) {
      orphaned.push(id);
      visiting.delete(id);
      visited.add(id);
      return;
    }

    if (entry.parent !== null) {
      checkCircular(entry.parent, path.concat(id));
    }

    visiting.delete(id);
    visited.add(id);
  }

  for (const id of Object.keys(tree)) {
    if (!visited.has(id)) {
      checkCircular(id, []);
    }
  }

  // Check for orphaned nodes
  for (const [id, entry] of Object.entries(tree)) {
    if (entry.parent !== null && !tree[entry.parent]) {
      orphaned.push(id);
    }
  }

  return { circular, orphaned };
}

/**
 * Main scan command handler
 */
export async function handleScan(options: ScanOptions = {}): Promise<void> {
  const root = process.cwd();
  const docsDir = join(root, '.ai-docs', 'docs');
  const filesDir = join(root, '.ai-docs', 'files');
  
  if (!existsSync(docsDir)) {
    console.error('Error: .ai-docs/docs/ directory does not exist. Run `ai-docs init` first.');
    process.exit(1);
  }

  console.log('Scanning documentation files...\n');

  // 1. Find all .md files in both docs and files directories
  const docsMdFiles = await findMarkdownFiles(docsDir, root);
  const filesMdFiles = existsSync(filesDir) ? await findMarkdownFiles(filesDir, root) : [];
  const mdFiles = [...docsMdFiles, ...filesMdFiles];
  console.log(`Found ${mdFiles.length} markdown files (${docsMdFiles.length} in docs, ${filesMdFiles.length} in files)`);

  if (mdFiles.length === 0) {
    console.log('No markdown files found. Creating empty tree.');
    const emptyTree: TreeData = {};
    await writeFile(
      join(docsDir, 'ai-tree.json'),
      JSON.stringify(emptyTree, null, 2),
      'utf-8'
    );
    console.log('✓ Created .ai-docs/docs/ai-tree.json (empty)');
    return;
  }

  // 2. Parse frontmatter for each file
  const tree: TreeData = {};
  const warnings: string[] = [];
  const duplicateIds: string[] = [];
  const filePathToId = new Map<string, string>(); // Map file paths to IDs

  for (const filePath of mdFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const { meta, body } = parse(content);

      // Extract required fields
      const id = meta.id;
      const title = meta.title || meta.id || 'Untitled';
      const parent = meta.parent === undefined ? null : meta.parent;
      const order = typeof meta.order === 'number' ? meta.order : 0;

      // Validate id
      if (!id) {
        warnings.push(`File ${filePath} is missing 'id' in frontmatter, skipping`);
        continue;
      }

      // Check for duplicate ids
      if (tree[id]) {
        duplicateIds.push(id);
        warnings.push(`Duplicate id "${id}" found in ${filePath}, overwriting previous entry`);
      }

      // Get relative path from project root
      const relPath = filePath.replace(root + '/', '').replace(root + '\\', '');

      // Extract references from body content
      const currentDir = dirname(filePath);
      const references = extractMarkdownReferences(body, currentDir, root);

      // Create tree entry
      tree[id] = {
        id,
        title,
        parent,
        order,
        path: relPath,
        references: references.length > 0 ? references : undefined
      };
      
      filePathToId.set(relPath, id);
    } catch (err) {
      warnings.push(`Error processing ${filePath}: ${err}`);
    }
  }

  // 3. Find all referenced files recursively
  console.log('Extracting referenced files...');
  const allReferencedPaths = await findAllReferencedFiles(
    Array.from(filePathToId.keys()),
    root
  );
  
  // 4. Add referenced files that aren't already in the tree
  let addedReferenced = 0;
  for (const refPath of allReferencedPaths) {
    // Check if this file is already in the tree
    const existingId = filePathToId.get(refPath);
    if (existingId && tree[existingId]) {
      continue; // Already in tree
    }
    
    // Check if file exists and has frontmatter
    const fullPath = refPath.startsWith(root) ? refPath : join(root, refPath);
    if (!existsSync(fullPath)) continue;
    
    try {
      const content = await readFile(fullPath, 'utf-8');
      const { meta } = parse(content);
      
      if (meta.id) {
        // File has frontmatter but wasn't scanned (maybe in a different location)
        // This shouldn't happen, but handle it gracefully
        continue;
      }
      
      // File doesn't have frontmatter, generate entry
      const entry = generateEntryForReferencedFile(fullPath, root);
      
      // Ensure unique ID
      let uniqueId = entry.id;
      let counter = 1;
      while (tree[uniqueId]) {
        uniqueId = `${entry.id}-${counter}`;
        counter++;
      }
      entry.id = uniqueId;
      
      tree[uniqueId] = entry;
      filePathToId.set(refPath, uniqueId);
      addedReferenced++;
    } catch (err) {
      warnings.push(`Error processing referenced file ${refPath}: ${err}`);
    }
  }
  
  if (addedReferenced > 0) {
    console.log(`✓ Added ${addedReferenced} referenced files to tree`);
  }

  // 5. Analyze code structure and discover source files
  let codeStructure: CodeStructure | null = null;
  const suggestions: HierarchySuggestion[] = [];
  const sourceFileToModule = new Map<string, string>(); // Map source file path to module ID

  if (options.analyzeCode !== false) {
    console.log('\nAnalyzing code structure...');
    try {
      codeStructure = await analyzeCodeStructure(root);
      console.log(`  ✓ Found ${codeStructure.sourceFiles.length} source files`);

      // Get hierarchy suggestions
      const hierarchySuggestions = suggestModuleHierarchy(codeStructure.sourceFiles, tree);
      suggestions.push(...hierarchySuggestions);

      // Link source files to existing modules
      for (const sourceFile of codeStructure.sourceFiles) {
        // Try to find matching module by ID or path
        const matchingModule = Object.values(tree).find(module => {
          // Check if module ID matches
          if (module.id === sourceFile.suggestedModuleId || module.id === sourceFile.suggestedParentId) {
            return true;
          }
          // Check if module path suggests it's related
          if (module.path && sourceFile.relativePath.includes(module.path.replace('.ai-docs/docs/', ''))) {
            return true;
          }
          return false;
        });

        if (matchingModule) {
          // Link source file to module
          if (!matchingModule.sourceFiles) {
            matchingModule.sourceFiles = [];
          }
          matchingModule.sourceFiles.push(sourceFile.relativePath);
          sourceFileToModule.set(sourceFile.relativePath, matchingModule.id);
        } else if (options.autoLink !== false) {
          // Create virtual entry for source file
          const entry = generateEntryForSourceFile(sourceFile, root);
          
          // Ensure unique ID
          let uniqueId = entry.id;
          let counter = 1;
          while (tree[uniqueId]) {
            uniqueId = `${entry.id}-${counter}`;
            counter++;
          }
          entry.id = uniqueId;

          // If parent doesn't exist, try to create it or set to root
          if (entry.parent && !tree[entry.parent]) {
            // Check if we should create parent module
            const parentFiles = codeStructure.sourceFiles.filter(
              sf => sf.suggestedParentId === entry.parent
            );
            if (parentFiles.length > 0) {
              // Create parent module entry
              const parentEntry: TreeEntry = {
                id: entry.parent,
                title: entry.parent.charAt(0).toUpperCase() + entry.parent.slice(1).replace(/-/g, ' '),
                parent: 'root',
                order: 10,
                path: '', // No doc file
                sourceFiles: [],
                isSourceFile: false
              };
              tree[entry.parent] = parentEntry;
            } else {
              entry.parent = null;
            }
          }

          tree[uniqueId] = entry;
          sourceFileToModule.set(sourceFile.relativePath, uniqueId);
        }
      }

      // Apply hierarchy suggestions if not in suggest-only mode
      if (!options.suggestOnly && suggestions.length > 0) {
        console.log(`\nApplying ${suggestions.length} hierarchy suggestions...`);
        let applied = 0;
        for (const suggestion of suggestions) {
          if (suggestion.confidence === 'high' && tree[suggestion.moduleId]) {
            const entry = tree[suggestion.moduleId];
            // Only apply if parent is root or null (not manually set)
            if (entry.parent === 'root' || entry.parent === null) {
              entry.parent = suggestion.suggestedParent;
              entry.suggestedParent = suggestion.suggestedParent;
              applied++;
            }
          }
        }
        console.log(`  ✓ Applied ${applied} suggestions`);
      }
    } catch (error) {
      console.warn(`  ⚠ Warning: Code structure analysis failed: ${error}`);
    }
  }

  // 6. Update module entries with source files
  if (codeStructure) {
    for (const [moduleId, entry] of Object.entries(tree)) {
      if (entry.sourceFiles && entry.sourceFiles.length > 0) {
        // Already has source files linked
        continue;
      }

      // Try to find source files for this module
      const moduleSourceFiles = codeStructure.sourceFiles.filter(sf => {
        const mapping = mapSourceToModule(sf.relativePath);
        return mapping.moduleId === moduleId || mapping.parentId === moduleId;
      });

      if (moduleSourceFiles.length > 0) {
        entry.sourceFiles = moduleSourceFiles.map(sf => sf.relativePath);
      }
    }
  }

  // 7. Validate parent references and check for circular references
  const validation = validateHierarchy(tree);
  const orphanedNodes = validation.orphaned;
  
  for (const orphan of orphanedNodes) {
    warnings.push(`Node "${orphan}" references non-existent parent`);
  }

  if (validation.circular.length > 0) {
    warnings.push(`Circular parent references detected: ${validation.circular.join('; ')}`);
  }

  // 8. Build children arrays for tree structure
  const childrenMap = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(tree)) {
    if (entry.parent !== null) {
      if (!childrenMap.has(entry.parent)) {
        childrenMap.set(entry.parent, []);
      }
      childrenMap.get(entry.parent)!.push(id);
    }
  }

  // Add children to entries (for JSON output, but don't store in TreeEntry type)
  const treeWithChildren: any = {};
  for (const [id, entry] of Object.entries(tree)) {
    treeWithChildren[id] = {
      ...entry,
      children: childrenMap.get(id) || []
    };
  }

  // 9. Write tree to JSON
  const treePath = join(docsDir, 'ai-tree.json');
  await writeFile(treePath, JSON.stringify(treeWithChildren, null, 2), 'utf-8');

  // 10. Print summary
  console.log(`\n✓ Scanned ${mdFiles.length} markdown files`);
  console.log(`✓ Created tree with ${Object.keys(tree).length} entries`);
  
  if (codeStructure) {
    const sourceFileEntries = Object.values(tree).filter(e => e.isSourceFile);
    if (sourceFileEntries.length > 0) {
      console.log(`✓ Linked ${sourceFileEntries.length} source files`);
    }
  }

  if (suggestions.length > 0 && options.suggestOnly) {
    console.log(`\n💡 Hierarchy Suggestions (${suggestions.length}):`);
    suggestions.forEach(s => {
      console.log(`  - ${s.moduleId} → ${s.suggestedParent} (${s.confidence}): ${s.reason}`);
    });
  }

  if (warnings.length > 0) {
    console.log(`\n⚠ Warnings (${warnings.length}):`);
    warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (duplicateIds.length > 0) {
    console.log(`\n⚠ Duplicate IDs found: ${duplicateIds.join(', ')}`);
  }

  if (orphanedNodes.length > 0) {
    console.log(`\n⚠ Orphaned nodes (parent not found): ${orphanedNodes.join(', ')}`);
  }

  console.log(`\n✓ Tree saved to .ai-docs/docs/ai-tree.json`);

  // 8. Copy assets (templates and viewer) to dist/
  console.log('\nCopying assets...');
  try {
    await copyAssets();
  } catch (error) {
    console.warn('Warning: Could not copy assets:', error);
  }
}

