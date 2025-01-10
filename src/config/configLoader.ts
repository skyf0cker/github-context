import { parse as parseYAML } from "yaml";
import { type Config } from "../types";

export async function loadConfig(configPath: string): Promise<Config> {
  try {
    const configFile = await Bun.file(configPath).text();
    return parseYAML(configFile) as Config;
  } catch (error) {
    console.error("Error loading configuration:", error);
    process.exit(1);
  }
}
