import type { RepoContent, Config } from '../types';

export function formatFileContent(
  path: string,
  content: string,
  includeLineNumbers: boolean
): string {
  const lines = content.split('\n');
  let formatted = `\n\nFile: ${path}\n\`\`\`\n`;

  if (includeLineNumbers) {
    formatted += lines.map((line, i) => `${(i + 1).toString().padStart(4)}: ${line}`).join('\n');
  } else {
    formatted += content;
  }

  formatted += '\n```\n';
  return formatted;
}

export function formatOutput(content: RepoContent, config: Config): string {
  if (config.output.format === 'json') {
    return JSON.stringify(content, null, 2);
  }

  let formatted = '';
  const categories: (keyof RepoContent)[] = ['readme', 'documentation', 'examples', 'tests'];

  for (const category of categories) {
    if (content[category].length > 0) {
      formatted += `# ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
      formatted += content[category].join('\n');
      formatted += '\n\n';
    }
  }

  return formatted;
}
