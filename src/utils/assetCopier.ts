import { readdir, stat, mkdir, copyFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Recursively copy a directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  // Ensure destination directory exists
  if (!existsSync(dest)) {
    await mkdir(dest, { recursive: true });
  }

  const entries = await readdir(src);
  
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    
    const stats = await stat(srcPath);
    
    if (stats.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copy templates and viewer assets from src to dist
 */
export async function copyAssets(): Promise<void> {
  const projectRoot = process.cwd();
  const srcTemplates = join(projectRoot, 'src', 'templates');
  const srcViewer = join(projectRoot, 'src', 'viewer');
  const distTemplates = join(projectRoot, 'dist', 'templates');
  const distViewer = join(projectRoot, 'dist', 'viewer');

  // Check if src directories exist
  if (!existsSync(srcTemplates)) {
    console.warn('Warning: src/templates directory not found, skipping copy');
    return;
  }

  if (!existsSync(srcViewer)) {
    console.warn('Warning: src/viewer directory not found, skipping copy');
    return;
  }

  try {
    await copyDirectory(srcTemplates, distTemplates);
    await copyDirectory(srcViewer, distViewer);
    console.log('✓ Copied templates and viewer assets to dist/');
  } catch (error) {
    console.error('Error copying assets:', error);
    throw error;
  }
}

