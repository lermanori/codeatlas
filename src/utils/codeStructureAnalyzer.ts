import { basename, dirname, join } from 'path';
import { scanProject } from './fileScanner.js';

export interface CodeStructure {
  sourceFiles: SourceFileInfo[];
  directoryMap: Map<string, string[]>; // directory -> files
  moduleMap: Map<string, string>; // file path -> module id
}

export interface SourceFileInfo {
  path: string;
  relativePath: string;
  directory: string;
  fileName: string;
  extension: string;
  suggestedModuleId: string;
  suggestedParentId?: string;
}

export interface HierarchySuggestion {
  moduleId: string;
  suggestedParent: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TreeData {
  [id: string]: {
    id: string;
    title: string;
    parent: string | null;
    path: string;
    [key: string]: any;
  };
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
const TEST_PATTERNS = ['test', 'spec', '__tests__', '__mocks__'];
const BUILD_PATTERNS = ['dist', 'build', '.next', '.nuxt', 'coverage', 'node_modules'];

/**
 * Analyze code structure and map source files to modules
 */
export async function analyzeCodeStructure(root: string): Promise<CodeStructure> {
  const sourceFiles: SourceFileInfo[] = [];
  const directoryMap = new Map<string, string[]>();
  const moduleMap = new Map<string, string>();

  // Scan for source files
  const allFiles = await scanProject(root, {
    exclude: BUILD_PATTERNS,
    include: SOURCE_EXTENSIONS.map(ext => ext.slice(1))
  });

  // Filter out test files and process source files
  for (const filePath of allFiles) {
    // filePath is already relative from scanProject
    const relPath = filePath;
    
    // Skip test files
    if (isTestFile(relPath)) {
      continue;
    }

    // Skip files in excluded directories
    if (isExcludedPath(relPath)) {
      continue;
    }

    const dir = dirname(relPath);
    const fileName = basename(relPath);
    const ext = getExtension(fileName);

    if (!SOURCE_EXTENSIONS.includes(ext)) {
      continue;
    }

    const mapping = mapSourceToModule(relPath);
    
    const sourceFile: SourceFileInfo = {
      path: join(root, relPath), // Full path for file operations
      relativePath: relPath,
      directory: dir,
      fileName: fileName.replace(ext, ''),
      extension: ext,
      suggestedModuleId: mapping.moduleId,
      suggestedParentId: mapping.parentId
    };

    sourceFiles.push(sourceFile);
    moduleMap.set(relPath, mapping.moduleId);

    // Build directory map
    if (!directoryMap.has(dir)) {
      directoryMap.set(dir, []);
    }
    directoryMap.get(dir)!.push(relPath);
  }

  return {
    sourceFiles,
    directoryMap,
    moduleMap
  };
}

/**
 * Map source file path to module ID and parent
 */
export function mapSourceToModule(filePath: string): { moduleId: string; parentId?: string } {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(p => p && p !== '.' && p !== '..');
  
  // Remove common prefixes
  let startIdx = 0;
  if (parts[0] === 'src' || parts[0] === 'lib' || parts[0] === 'app') {
    startIdx = 1;
  }

  if (parts.length <= startIdx) {
    return { moduleId: generateIdFromPath(filePath) };
  }

  const directory = parts[startIdx];
  const fileName = parts[parts.length - 1].replace(/\.[^.]+$/, '');

  // Map common directory names to module IDs
  const directoryToModule: { [key: string]: string } = {
    'commands': 'commands',
    'command': 'commands',
    'utils': 'utils',
    'util': 'utils',
    'llm': 'llm',
    'components': 'components',
    'component': 'components',
    'services': 'services',
    'service': 'services',
    'models': 'models',
    'model': 'models',
    'types': 'types',
    'type': 'types',
    'interfaces': 'interfaces',
    'interface': 'interfaces',
    'handlers': 'handlers',
    'handler': 'handlers',
    'routes': 'routes',
    'route': 'routes',
    'middleware': 'middleware',
    'config': 'config',
    'constants': 'constants'
  };

  const moduleId = directoryToModule[directory] || directory;
  
  // Generate sub-module ID
  const prefix = getSubModulePrefix(moduleId);
  const subModuleId = `${prefix}-${generateIdFromName(fileName)}`;

  // If this is a file directly in a module directory, suggest parent
  if (parts.length === startIdx + 2) {
    return {
      moduleId: subModuleId,
      parentId: moduleId
    };
  }

  // Otherwise, just use the module ID
  return { moduleId: subModuleId, parentId: moduleId };
}

/**
 * Suggest module hierarchy based on code structure
 */
export function suggestModuleHierarchy(
  sourceFiles: SourceFileInfo[],
  existingModules: TreeData
): HierarchySuggestion[] {
  const suggestions: HierarchySuggestion[] = [];
  const moduleToFiles = new Map<string, SourceFileInfo[]>();

  // Group files by suggested parent
  for (const file of sourceFiles) {
    if (file.suggestedParentId) {
      if (!moduleToFiles.has(file.suggestedParentId)) {
        moduleToFiles.set(file.suggestedParentId, []);
      }
      moduleToFiles.get(file.suggestedParentId)!.push(file);
    }
  }

  // For each parent module, suggest sub-modules
  for (const [parentId, files] of moduleToFiles.entries()) {
    // Check if parent module exists
    const parentExists = existingModules[parentId] !== undefined;

    if (!parentExists) {
      // Suggest creating parent module
      suggestions.push({
        moduleId: parentId,
        suggestedParent: 'root',
        reason: `Directory structure suggests creating a "${parentId}" module with ${files.length} sub-modules`,
        confidence: 'high'
      });
    }

    // Suggest sub-modules
    for (const file of files) {
      const existingModule = Object.values(existingModules).find(
        m => m.path && file.relativePath.includes(m.path.replace('.ai-docs/docs/', ''))
      );

      if (!existingModule) {
        suggestions.push({
          moduleId: file.suggestedModuleId,
          suggestedParent: parentId,
          reason: `Source file "${file.relativePath}" suggests sub-module under "${parentId}"`,
          confidence: 'high'
        });
      } else if (existingModule.parent === 'root' || existingModule.parent === null) {
        // Existing module is at root, suggest moving it
        suggestions.push({
          moduleId: existingModule.id,
          suggestedParent: parentId,
          reason: `Code structure suggests "${existingModule.id}" should be under "${parentId}"`,
          confidence: 'medium'
        });
      }
    }
  }

  return suggestions;
}

/**
 * Generate ID from file path
 */
function generateIdFromPath(path: string): string {
  return path
    .replace(/^src\//, '')
    .replace(/^lib\//, '')
    .replace(/^app\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\/\\]/g, '-')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate ID from name
 */
function generateIdFromName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Get sub-module prefix based on parent module
 */
function getSubModulePrefix(parentModuleId: string): string {
  const prefixMap: { [key: string]: string } = {
    'commands': 'command',
    'utils': 'util',
    'components': 'component',
    'services': 'service',
    'models': 'model',
    'types': 'type',
    'interfaces': 'interface',
    'handlers': 'handler',
    'routes': 'route'
  };

  return prefixMap[parentModuleId] || parentModuleId.slice(0, -1);
}

/**
 * Check if file is a test file
 */
function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return TEST_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Check if path should be excluded
 */
function isExcludedPath(path: string): boolean {
  const lower = path.toLowerCase();
  return BUILD_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Get file extension
 */
function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(lastDot) : '';
}

