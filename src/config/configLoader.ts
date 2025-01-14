import { parse as parseYAML } from 'yaml';
import { type Config } from '../types';
import { readFile } from 'fs/promises';

export async function loadConfig(configPath: string): Promise<Config> {
  try {
    const configFile = await readFile(configPath, 'utf8');
    return parseYAML(configFile) as Config;
  } catch (error) {
    console.error('Error loading configuration:', error);
    process.exit(1);
  }
}
