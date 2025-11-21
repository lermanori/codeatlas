import inquirer from 'inquirer';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const ENV_FILE = '.ai-docs/.env';

/**
 * Load API key from .env file if it exists
 */
async function loadApiKeyFromEnv(): Promise<string | null> {
  const envPath = join(process.cwd(), ENV_FILE);
  
  if (!existsSync(envPath)) {
    return null;
  }

  try {
    const content = await readFile(envPath, 'utf-8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Parse KEY=VALUE format
      const match = trimmed.match(/^OPENAI_API_KEY\s*=\s*(.+)$/);
      if (match) {
        // Remove quotes if present
        const value = match[1].trim().replace(/^["']|["']$/g, '');
        return value || null;
      }
    }
  } catch (err) {
    // If we can't read the file, just return null
    return null;
  }

  return null;
}

/**
 * Save API key to .env file
 */
async function saveApiKeyToEnv(apiKey: string): Promise<void> {
  const envPath = join(process.cwd(), ENV_FILE);
  
  // Ensure .ai-docs directory exists
  const aiDocsDir = join(process.cwd(), '.ai-docs');
  if (!existsSync(aiDocsDir)) {
    mkdirSync(aiDocsDir, { recursive: true });
  }
  
  let content = '';
  let keyFound = false;
  
  // Read existing .env file if it exists
  if (existsSync(envPath)) {
    try {
      content = await readFile(envPath, 'utf-8');
      const lines = content.split('\n');
      const updatedLines: string[] = [];
      
      for (const line of lines) {
        if (line.trim().match(/^OPENAI_API_KEY\s*=/)) {
          updatedLines.push(`OPENAI_API_KEY=${apiKey}`);
          keyFound = true;
        } else {
          updatedLines.push(line);
        }
      }
      
      content = updatedLines.join('\n');
    } catch (err) {
      // If we can't read it, we'll create a new one
      content = '';
    }
  }
  
  // Add the key if it wasn't found in existing content
  if (!keyFound) {
    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
    content += `OPENAI_API_KEY=${apiKey}\n`;
  }
  
  // Write the .env file
  await writeFile(envPath, content, 'utf-8');
}

/**
 * Check if OpenAI API key is set, and prompt for it if missing.
 * Checks environment variables first, then .env file, then prompts.
 * Sets the key in process.env for the current session and saves to .env for future sessions.
 */
export async function ensureApiKey(): Promise<void> {
  // First check process.env
  if (process.env.OPENAI_API_KEY) {
    return; // API key already set
  }

  // Then check .env file
  const savedKey = await loadApiKeyFromEnv();
  if (savedKey) {
    process.env.OPENAI_API_KEY = savedKey;
    return; // API key loaded from .env
  }

  // If not found, prompt the user
  console.log('\nOpenAI API key not found in environment variables or .ai-docs/.env file.');
  console.log('CodeAtlas needs an API key to generate documentation with AI.\n');

  const answer = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your OpenAI API key:',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'API key cannot be empty';
        }
        // Basic validation - OpenAI keys typically start with 'sk-'
        if (!input.trim().startsWith('sk-')) {
          return 'API key should start with "sk-". Please check your key.';
        }
        return true;
      }
    }
  ]);

  const apiKey = answer.apiKey.trim();
  process.env.OPENAI_API_KEY = apiKey;
  
  // Save to .env file for future use
  await saveApiKeyToEnv(apiKey);
  console.log('✓ API key set for this session and saved to .ai-docs/.env file.\n');
}

