import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname, normalize, resolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DevOptions {
  port?: number;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

/**
 * Get MIME type for a file
 */
function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'text/plain';
}

/**
 * Serve static file
 */
async function serveFile(res: ServerResponse, filePath: string, contentType: string): Promise<void> {
  try {
    const content = await readFile(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
}

/**
 * Main dev command handler
 */
export async function handleDev(options: DevOptions): Promise<void> {
  const port = options.port || 8765;
  const root = process.cwd();
  const viewerDir = join(__dirname, '..', 'viewer');
  const srcViewerDir = join(process.cwd(), 'src', 'viewer');
  const finalViewerDir = existsSync(viewerDir) ? viewerDir : srcViewerDir;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
      // Route: /
      if (url === '/') {
        const indexPath = join(finalViewerDir, 'index.html');
        await serveFile(res, indexPath, 'text/html');
        return;
      }

      // Route: /viewer.js
      if (url === '/viewer.js') {
        const jsPath = join(finalViewerDir, 'viewer.js');
        await serveFile(res, jsPath, 'application/javascript');
        return;
      }

      // Route: /style.css
      if (url === '/style.css') {
        const cssPath = join(finalViewerDir, 'style.css');
        await serveFile(res, cssPath, 'text/css');
        return;
      }

      // Route: /ai-tree.json
      if (url === '/ai-tree.json') {
        const treePath = resolve(root, '.ai-docs', 'docs', 'ai-tree.json');
        if (existsSync(treePath)) {
          const content = await readFile(treePath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(content);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        }
        return;
      }

      // Route: /usage.json
      if (url === '/usage.json') {
        const usagePath = resolve(root, '.ai-docs', 'usage.json');
        if (existsSync(usagePath)) {
          const content = await readFile(usagePath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(content);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"totals":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0},"byCommand":{},"byCategory":{}}');
        }
        return;
      }

      // Route: /docs/* - Serve markdown files
      if (url.startsWith('/docs/')) {
        const filePath = url.replace('/docs/', '');
        const decodedPath = decodeURIComponent(filePath);
        
        // Resolve paths to absolute paths for reliable comparison
        const docsDir = resolve(root, '.ai-docs', 'docs');
        const fullPath = resolve(docsDir, decodedPath);
        
        // Security: only allow files in .ai-docs/docs directory
        // Since we resolve from docsDir, the fullPath should always start with docsDir
        // But we check anyway to prevent directory traversal attacks
        const normalizedDocsDir = normalize(docsDir + '/');
        const normalizedFullPath = normalize(fullPath);
        if (!normalizedFullPath.startsWith(normalizedDocsDir)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: File must be in .ai-docs/docs directory');
          return;
        }
        
        // Only serve .md files
        if (extname(fullPath) !== '.md') {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Forbidden: Only markdown files are allowed');
          return;
        }
        
        if (existsSync(fullPath)) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(content);
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Error reading file: ${err.message}`);
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(`File not found: ${decodedPath}`);
        }
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Server error: ${err.message}`);
    }
  });

  server.listen(port, () => {
    console.log(`CodeAtlas viewer running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop');
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
      console.log('Server stopped');
      process.exit(0);
    });
  });
}

