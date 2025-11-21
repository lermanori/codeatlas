import OpenAI from 'openai';
import { updateUsage } from '../utils/usageLogger.js';

export interface LLMCallOptions {
  command: string;
  category: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
}

// Default model
const DEFAULT_MODEL = 'gpt-4';

// Initialize OpenAI client
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is required.\n' +
        'Set it with: export OPENAI_API_KEY=your_key_here'
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * Call LLM with automatic token usage tracking.
 * All LLM calls in CodeAtlas should go through this function.
 * 
 * @param options - LLM call options including command, category, messages, and optional model
 * @returns Chat completion response from OpenAI
 */
export async function callLLM(
  options: LLMCallOptions
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { command, category, messages, model = DEFAULT_MODEL } = options;
  const openai = getClient();

  try {
    const response = await openai.chat.completions.create({
      model,
      messages
    });

    // Track token usage if available
    if (response.usage) {
      await updateUsage(command, category, {
        prompt_tokens: response.usage.prompt_tokens || 0,
        completion_tokens: response.usage.completion_tokens || 0,
        total_tokens: response.usage.total_tokens || 0
      });
    } else {
      // Log warning if usage is missing (older models or errors)
      console.warn(
        `Warning: No usage data returned for ${command}/${category}. ` +
        'Token tracking may be incomplete.'
      );
    }

    return response;
  } catch (error: any) {
    // Provide helpful error messages without exposing API keys
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) {
        throw new Error('Invalid OpenAI API key. Please check your OPENAI_API_KEY environment variable.');
      } else if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      } else if (error.status === 404) {
        throw new Error(`Model "${model}" not found. Please check the model name.`);
      } else {
        throw new Error(`OpenAI API error: ${error.message}`);
      }
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Network error: Could not connect to OpenAI API. Please check your internet connection.');
    } else {
      throw error;
    }
  }
}

