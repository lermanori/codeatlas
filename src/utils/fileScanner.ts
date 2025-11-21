import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

export interface ScanOptions {
  exclude?: string[];
  include?: string[];
}

const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.ai-docs',
  '.cursor',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.nyc_output'
];

/**
 * Recursively scan project directories to find relevant files.
 * @param root - Root directory to scan from
 * @param options - Scan options including exclude/include patterns
 * @returns Array of relative file paths from project root
 */
export async function scanProject(
  root: string,
  options: ScanOptions = {}
): Promise<string[]> {
  const excludePatterns = [...DEFAULT_EXCLUDE, ...(options.exclude || [])];
  const files: string[] = [];

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir);

      for (const entry of entries) {
        // Skip dot-files at root level
        if (entry.startsWith('.') && dir === root) {
          continue;
        }

        const fullPath = join(dir, entry);
        const relPath = relative(root, fullPath);

        // Check if path should be excluded
        const shouldExclude = excludePatterns.some(pattern => {
          // Check if pattern matches any part of the path
          return relPath.includes(pattern) || entry === pattern;
        });

        if (shouldExclude) {
          continue;
        }

        try {
          const stats = await stat(fullPath);

          if (stats.isDirectory()) {
            await walkDir(fullPath);
          } else if (stats.isFile()) {
            // Apply include filter if specified
            if (options.include && options.include.length > 0) {
              const matches = options.include.some(pattern => {
                return relPath.includes(pattern) || entry.includes(pattern);
              });
              if (!matches) {
                continue;
              }
            }
            files.push(relPath);
          }
        } catch (err) {
          // Skip files we can't access (permissions, etc.)
          console.warn(`Warning: Could not access ${fullPath}: ${err}`);
        }
      }
    } catch (err) {
      // Skip directories we can't access
      console.warn(`Warning: Could not read directory ${dir}: ${err}`);
    }
  }

  await walkDir(root);
  return files;
}

