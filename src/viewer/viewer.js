// Tree data structure
let treeData = {};
let usageData = {};
let currentFile = null;
let selectedModel = 'gpt-4';

// Model pricing configuration (per 1M tokens)
const MODEL_PRICING = {
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1-preview': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 }
};

// Load tree data
async function loadTree() {
  try {
    const response = await fetch('/ai-tree.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    treeData = await response.json();
    renderTree();
  } catch (error) {
    const container = document.getElementById('tree-container');
    container.innerHTML = `<div class="error">Error loading documentation tree: ${error.message}</div>`;
  }
}

// Helper function to join paths (simple implementation)
function join(...paths) {
  return paths
    .filter(p => p)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
}

// Build a map of file paths to tree entries for quick lookup
function buildPathMap() {
  const pathMap = new Map();
  Object.values(treeData).forEach(entry => {
    // Normalize path (remove .ai-docs/docs/ prefix if present)
    let normalizedPath = entry.path;
    if (normalizedPath.startsWith('.ai-docs/docs/')) {
      normalizedPath = normalizedPath.replace('.ai-docs/docs/', '');
    } else if (normalizedPath.startsWith('docs/')) {
      normalizedPath = normalizedPath.replace('docs/', '');
    }
    pathMap.set(normalizedPath, entry);
    // Also map by full path
    pathMap.set(entry.path, entry);
  });
  return pathMap;
}

// Load markdown file content
async function loadMarkdown(path) {
  try {
    // Normalize path: remove .ai-docs/docs/ or docs/ prefix if present
    let filePath = path;
    if (filePath.startsWith('.ai-docs/docs/')) {
      filePath = filePath.replace('.ai-docs/docs/', '');
    } else if (filePath.startsWith('docs/')) {
      filePath = filePath.replace('docs/', '');
    }
    
    const response = await fetch(`/docs/${encodeURIComponent(filePath)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const content = await response.text();
    renderMarkdown(content);
    currentFile = path;
    
    // Update active state in tree
    document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('active'));
    const activeNode = document.querySelector(`[data-path="${path}"]`);
    if (activeNode) {
      const header = activeNode.querySelector('.tree-node-header');
      if (header) {
        header.classList.add('active');
      }
    }
  } catch (error) {
    const container = document.getElementById('content-container');
    container.innerHTML = `<div class="error">Error loading file: ${error.message}</div>`;
  }
}

// Simple markdown renderer
function renderMarkdown(content) {
  const container = document.getElementById('content-container');
  
  // Extract frontmatter if present
  let body = content;
  if (content.startsWith('---\n')) {
    const endIndex = content.indexOf('\n---\n', 4);
    if (endIndex !== -1) {
      body = content.slice(endIndex + 5).trimStart();
    }
  }
  
  // Build path map for reference lookup
  const pathMap = buildPathMap();
  
  // Simple markdown to HTML conversion
  let html = body
    // Code blocks (must come before inline code)
    .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
    // Headers
    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    // Links - handle internal markdown files specially
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, (match, text, href) => {
      // Check if this is a markdown file link
      if (href.endsWith('.md') && !href.startsWith('http://') && !href.startsWith('https://')) {
        // Try to find the file in the tree
        let targetPath = href;
        
        // Handle relative paths
        if (currentFile) {
          let currentDir = currentFile;
          if (currentDir.startsWith('.ai-docs/docs/')) {
            currentDir = currentDir.replace('.ai-docs/docs/', '');
          } else if (currentDir.startsWith('docs/')) {
            currentDir = currentDir.replace('docs/', '');
          }
          const lastSlashIndex = currentDir.lastIndexOf('/');
          if (lastSlashIndex !== -1) {
            currentDir = currentDir.substring(0, lastSlashIndex);
            
            if (href.startsWith('./')) {
              targetPath = join(currentDir, href.slice(2));
            } else if (!href.startsWith('/')) {
              targetPath = join(currentDir, href);
            }
          } else {
            // File is at root level
            if (href.startsWith('./')) {
              targetPath = href.slice(2);
            } else if (!href.startsWith('/')) {
              targetPath = href;
            }
          }
        }
        
        // Normalize path
        let normalizedPath = targetPath;
        if (normalizedPath.startsWith('.ai-docs/docs/')) {
          normalizedPath = normalizedPath.replace('.ai-docs/docs/', '');
        } else if (normalizedPath.startsWith('docs/')) {
          normalizedPath = normalizedPath.replace('docs/', '');
        }
        
        // Check if file exists in tree
        const entry = pathMap.get(normalizedPath) || pathMap.get(targetPath);
        if (entry) {
          // Internal link - navigate within viewer
          return `<a href="#" class="internal-link" data-path="${entry.path}">${text}</a>`;
        }
      }
      // External link
      return `<a href="${href}" target="_blank">${text}</a>`;
    })
    // Horizontal rules
    .replace(/^---$/gim, '<hr>')
    .replace(/^\*\*\*$/gim, '<hr>');
  
  // Handle lists - convert list items to proper HTML
  const lines = html.split('\n');
  let inList = false;
  let listItems = [];
  let processedLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    
    if (listMatch) {
      if (!inList) {
        inList = true;
        listItems = [];
      }
      listItems.push(`<li>${listMatch[3]}</li>`);
    } else {
      if (inList) {
        processedLines.push(`<ul>${listItems.join('')}</ul>`);
        listItems = [];
        inList = false;
      }
      if (line.trim()) {
        processedLines.push(line);
      }
    }
  }
  
  if (inList && listItems.length > 0) {
    processedLines.push(`<ul>${listItems.join('')}</ul>`);
  }
  
  html = processedLines.join('\n');
  
  // Wrap consecutive non-list, non-header lines in paragraphs
  html = html
    .split('\n')
    .map((line, index, array) => {
      if (line.match(/^<(h[1-6]|ul|ol|pre|hr)/)) {
        return line;
      }
      if (line.trim() && !line.match(/^<p>/) && !line.match(/<\/p>$/)) {
        return `<p>${line}</p>`;
      }
      return line;
    })
    .join('\n');
  
  // Add source file information if available
  const currentEntry = Object.values(treeData).find(e => e.path === currentFile);
  if (currentEntry) {
    if (currentEntry.sourceFile) {
      html = `<div class="source-file-badge"><strong>Source:</strong> <code>${currentEntry.sourceFile}</code></div>` + html;
    }
    if (currentEntry.sourceFiles && currentEntry.sourceFiles.length > 0) {
      html = `<div class="source-files-badge"><strong>Source Files:</strong> ${currentEntry.sourceFiles.map(f => `<code>${f}</code>`).join(', ')}</div>` + html;
    }
  }

  container.innerHTML = `<div class="markdown-content">${html}</div>`;
  
  // Add click handlers for internal links
  container.querySelectorAll('.internal-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const path = link.getAttribute('data-path');
      if (path) {
        loadMarkdown(path);
      }
    });
  });
}

// Load usage data
async function loadUsage() {
  try {
    const response = await fetch('/usage.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    usageData = await response.json();
    renderUsage();
  } catch (error) {
    const container = document.getElementById('usage-container');
    container.innerHTML = `<div class="error">Error loading usage data: ${error.message}</div>`;
  }
}

// Build tree structure from flat map
function buildTree() {
  const nodes = Object.values(treeData);
  const rootNodes = nodes.filter(n => n.parent === null);
  
  function buildChildren(parentId) {
    return nodes
      .filter(n => n.parent === parentId)
      .sort((a, b) => a.order - b.order)
      .map(node => ({
        ...node,
        children: buildChildren(node.id)
      }));
  }
  
  return rootNodes
    .sort((a, b) => a.order - b.order)
    .map(node => ({
      ...node,
      children: buildChildren(node.id)
    }));
}

// Render tree
function renderTree() {
  const container = document.getElementById('tree-container');
  
  if (Object.keys(treeData).length === 0) {
    container.innerHTML = '<div class="empty">No documentation found. Run <code>ai-docs scan</code> to build the tree.</div>';
    return;
  }
  
  const tree = buildTree();
  container.innerHTML = '';
  
  function renderNode(node, level = 0) {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'tree-node';
    nodeDiv.dataset.path = node.path;
    
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = level === 0; // Root nodes expanded by default
    
    const header = document.createElement('div');
    header.className = 'tree-node-header';
    
    // Handle clicking the header to load content (for all nodes with paths)
    header.onclick = (e) => {
      // Don't trigger if clicking the toggle button
      if (e.target.classList.contains('tree-toggle')) {
        return;
      }
      
      // Load content if node has a path
      if (node.path) {
        loadMarkdown(node.path);
        // Update active state
        document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('active'));
        header.classList.add('active');
      } else if (node.isSourceFile && !node.path) {
        // If it's a source file without a doc, show source file info
        showSourceFileInfo(node);
        // Update active state
        document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('active'));
        header.classList.add('active');
      }
    };
    
    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = `tree-toggle ${isExpanded ? 'expanded' : ''}`;
      toggle.textContent = isExpanded ? '▼' : '▶';
      toggle.onclick = (e) => {
        e.stopPropagation(); // Prevent header click
        const childrenDiv = nodeDiv.querySelector('.tree-node-children');
        if (childrenDiv) {
          const isCurrentlyExpanded = childrenDiv.style.display !== 'none';
          childrenDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';
          toggle.textContent = isCurrentlyExpanded ? '▶' : '▼';
          toggle.className = `tree-toggle ${!isCurrentlyExpanded ? 'expanded' : ''}`;
        }
      };
      header.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'tree-spacer';
      header.appendChild(spacer);
    }
    
    const title = document.createElement('span');
    title.className = 'tree-node-title';
    if (node.isReferenced) {
      title.classList.add('referenced-file');
    }
    if (node.isSourceFile) {
      title.classList.add('source-file');
    }
    title.textContent = node.title;
    
    // Add source file indicator
    if (node.sourceFile) {
      const sourceIndicator = document.createElement('span');
      sourceIndicator.className = 'source-indicator';
      sourceIndicator.textContent = ' 📄';
      sourceIndicator.title = `Source file: ${node.sourceFile}`;
      sourceIndicator.style.cursor = 'help';
      title.appendChild(sourceIndicator);
    }
    
    if (node.isReferenced) {
      // Add a small indicator
      const indicator = document.createElement('span');
      indicator.className = 'ref-indicator';
      indicator.textContent = ' ↪';
      indicator.title = 'Referenced file';
      title.appendChild(indicator);
    }
    header.appendChild(title);
    
    nodeDiv.appendChild(header);
    
    if (hasChildren) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-node-children';
      childrenDiv.style.display = isExpanded ? 'block' : 'none';
      
      node.children.forEach(child => {
        childrenDiv.appendChild(renderNode(child, level + 1));
      });
      
      nodeDiv.appendChild(childrenDiv);
    }
    
    return nodeDiv;
  }
  
  tree.forEach(rootNode => {
    container.appendChild(renderNode(rootNode));
  });
}

// Update model pricing display
function updateModelPricing() {
  const pricingEl = document.getElementById('model-pricing');
  if (!pricingEl) return;
  
  const pricing = MODEL_PRICING[selectedModel];
  if (pricing) {
    pricingEl.textContent = `$${pricing.input}/1M in, $${pricing.output}/1M out`;
  } else {
    pricingEl.textContent = '';
  }
}

// Render usage statistics
function renderUsage() {
  const container = document.getElementById('usage-container');
  
  if (!usageData.totals || usageData.totals.total_tokens === 0) {
    container.innerHTML = '<div class="empty">No LLM usage recorded yet.</div>';
    return;
  }
  
  const totals = usageData.totals || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  
  // Get pricing for selected model
  const pricing = MODEL_PRICING[selectedModel] || MODEL_PRICING['gpt-4'];
  const inputPricePer1M = pricing.input;
  const outputPricePer1M = pricing.output;
  const inputCost = (totals.prompt_tokens / 1000000) * inputPricePer1M;
  const outputCost = (totals.completion_tokens / 1000000) * outputPricePer1M;
  const totalCost = inputCost + outputCost;
  
  let html = '<div class="usage-section">';
  html += '<h3>TOTALS</h3>';
  html += `<div class="usage-stat"><span class="label">PROMPT:</span> <span class="value">${formatNumber(totals.prompt_tokens)}</span></div>`;
  html += `<div class="usage-stat"><span class="label">COMPLETION:</span> <span class="value">${formatNumber(totals.completion_tokens)}</span></div>`;
  html += `<div class="usage-stat"><span class="label">TOTAL:</span> <span class="value highlight">${formatNumber(totals.total_tokens)}</span></div>`;
  html += `<div class="usage-stat"><span class="label">COST:</span> <span class="value highlight">$${formatPrice(totalCost)}</span></div>`;
  html += '</div>';
  
  if (usageData.byCommand && Object.keys(usageData.byCommand).length > 0) {
    html += '<div class="usage-section">';
    html += '<h3>BY COMMAND</h3>';
    for (const [command, usage] of Object.entries(usageData.byCommand)) {
      const cmdInputCost = (usage.prompt_tokens / 1000000) * inputPricePer1M;
      const cmdOutputCost = (usage.completion_tokens / 1000000) * outputPricePer1M;
      const cmdTotalCost = cmdInputCost + cmdOutputCost;
      html += `<div class="usage-stat"><span class="label">${command.toUpperCase()}:</span> <span class="value">${formatNumber(usage.total_tokens)}</span> <span class="cost">($${formatPrice(cmdTotalCost)})</span></div>`;
    }
    html += '</div>';
  }
  
  if (usageData.byCategory && Object.keys(usageData.byCategory).length > 0) {
    html += '<div class="usage-section">';
    html += '<h3>BY CATEGORY</h3>';
    for (const [category, usage] of Object.entries(usageData.byCategory)) {
      const catInputCost = (usage.prompt_tokens / 1000000) * inputPricePer1M;
      const catOutputCost = (usage.completion_tokens / 1000000) * outputPricePer1M;
      const catTotalCost = catInputCost + catOutputCost;
      html += `<div class="usage-stat"><span class="label">${category.toUpperCase()}:</span> <span class="value">${formatNumber(usage.total_tokens)}</span> <span class="cost">($${formatPrice(catTotalCost)})</span></div>`;
    }
    html += '</div>';
  }
  
  container.innerHTML = html;
}

// Format number with commas
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format price with 4 decimal places
function formatPrice(price) {
  return price.toFixed(4);
}

// Show source file information
function showSourceFileInfo(node) {
  const container = document.getElementById('content-container');
  let html = '<div class="markdown-content">';
  html += `<h1>${node.title}</h1>`;
  
  if (node.sourceFile) {
    html += `<div class="source-file-info">`;
    html += `<p><strong>Source File:</strong> <code>${node.sourceFile}</code></p>`;
    html += `<p class="info-note">This is a virtual documentation entry linked to a source file. Create a documentation file to add detailed documentation.</p>`;
    html += `</div>`;
  }
  
  if (node.sourceFiles && node.sourceFiles.length > 0) {
    html += `<div class="source-files-list">`;
    html += `<h2>Source Files</h2>`;
    html += `<ul>`;
    node.sourceFiles.forEach(file => {
      html += `<li><code>${file}</code></li>`;
    });
    html += `</ul>`;
    html += `</div>`;
  }
  
  if (node.suggestedParent) {
    html += `<p class="info-note"><strong>Suggested Parent:</strong> ${node.suggestedParent}</p>`;
  }
  
  html += '</div>';
  container.innerHTML = html;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadTree();
  loadUsage();
  
  // Setup model selector
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.value = selectedModel;
    updateModelPricing();
    
    modelSelect.addEventListener('change', (e) => {
      selectedModel = e.target.value;
      updateModelPricing();
      renderUsage();
    });
  }
});

