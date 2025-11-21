import yaml from 'js-yaml';

export interface FrontmatterMeta {
  id?: string;
  title?: string;
  parent?: string | null;
  order?: number;
  [key: string]: any;
}

export interface ParsedFrontmatter {
  meta: FrontmatterMeta;
  body: string;
}

/**
 * Parse YAML frontmatter from Markdown files.
 * Detects YAML block between leading `---` and next `---`.
 * @param content - File content to parse
 * @returns Object with metadata and body
 */
export function parse(content: string): ParsedFrontmatter {
  // Check if content starts with frontmatter delimiter
  if (!content.startsWith('---\n')) {
    return { meta: {}, body: content };
  }

  // Find the closing delimiter
  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    // No closing delimiter found, treat as no frontmatter
    return { meta: {}, body: content };
  }

  // Extract frontmatter and body
  const frontmatterText = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5).trimStart();

  try {
    // Parse YAML
    const meta = yaml.load(frontmatterText) as FrontmatterMeta;
    
    if (typeof meta !== 'object' || meta === null) {
      return { meta: {}, body: content };
    }

    return { meta, body };
  } catch (err) {
    // If YAML parsing fails, log warning and return content as-is
    console.warn(`Warning: Failed to parse frontmatter: ${err}`);
    return { meta: {}, body: content };
  }
}

