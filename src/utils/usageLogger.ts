import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsageData {
  totals: TokenUsage;
  byCommand: Record<string, TokenUsage>;
  byCategory: Record<string, TokenUsage>;
}

const USAGE_FILE_PATH = '.ai-docs/usage.json';

/**
 * Load usage data from .ai-docs/usage.json
 * Returns empty structure if file doesn't exist or is corrupted
 */
export async function loadUsage(): Promise<UsageData> {
  const emptyData: UsageData = {
    totals: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    byCommand: {},
    byCategory: {}
  };

  if (!existsSync(USAGE_FILE_PATH)) {
    return emptyData;
  }

  try {
    const content = await readFile(USAGE_FILE_PATH, 'utf-8');
    const data = JSON.parse(content) as UsageData;
    
    // Validate structure
    if (!data.totals || !data.byCommand || !data.byCategory) {
      console.warn('Warning: usage.json has invalid structure, resetting');
      return emptyData;
    }

    return data;
  } catch (err) {
    console.warn(`Warning: Could not read usage.json: ${err}`);
    return emptyData;
  }
}

/**
 * Save usage data to .ai-docs/usage.json
 * Creates .ai-docs directory if it doesn't exist
 */
export async function saveUsage(data: UsageData): Promise<void> {
  // Ensure .ai-docs directory exists
  const dirPath = '.ai-docs';
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }

  try {
    const content = JSON.stringify(data, null, 2);
    await writeFile(USAGE_FILE_PATH, content, 'utf-8');
  } catch (err) {
    console.error(`Error: Could not write usage.json: ${err}`);
    throw err;
  }
}

/**
 * Update usage data with new token usage for a command and category
 * Aggregates into totals, byCommand, and byCategory
 */
export async function updateUsage(
  command: string,
  category: string,
  usage: TokenUsage
): Promise<void> {
  const data = await loadUsage();

  // Update totals
  data.totals.prompt_tokens += usage.prompt_tokens;
  data.totals.completion_tokens += usage.completion_tokens;
  data.totals.total_tokens += usage.total_tokens;

  // Update byCommand
  if (!data.byCommand[command]) {
    data.byCommand[command] = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  }
  data.byCommand[command].prompt_tokens += usage.prompt_tokens;
  data.byCommand[command].completion_tokens += usage.completion_tokens;
  data.byCommand[command].total_tokens += usage.total_tokens;

  // Update byCategory
  if (!data.byCategory[category]) {
    data.byCategory[category] = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
  }
  data.byCategory[category].prompt_tokens += usage.prompt_tokens;
  data.byCategory[category].completion_tokens += usage.completion_tokens;
  data.byCategory[category].total_tokens += usage.total_tokens;

  await saveUsage(data);
}

