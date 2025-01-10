import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../config/configLoader";
import { GitHubFetcher } from "../services/GithubFetcher";
import { formatOutput } from "../utils/formatters";
import { encode } from "gpt-tokenizer";
import path from "path";
import Bun from "bun";

interface FetchCommandOptions {
  config?: string;
  output?: string;
}

export async function fetchCommand(
  repoUrl: string,
  options: FetchCommandOptions,
) {
  console.log(chalk.bold("\nGitHub Context Analyzer\n"));

  const spinner = ora("Starting repository analysis...").start();

  try {
    // Load configuration
    const configPath =
      options.config || path.join(__dirname, "../config/defaultConfig.yaml");
    spinner.text = "Loading configuration...";
    const config = await loadConfig(configPath);

    // Override output file name if specified in command
    if (options.output) {
      config.output.file_name = options.output;
    }

    // Initialize fetcher
    spinner.text = "Initializing GitHub API client...";
    const fetcher = new GitHubFetcher(repoUrl, config);

    // Fetch content
    const content = await fetcher.fetchRepoContent();

    // Format output
    spinner.text = "Formatting content...";
    const output = formatOutput(content, config);

    // Save to file
    spinner.text = "Saving output...";
    await Bun.write(config.output.file_name, output);

    spinner.stop();

    // Calculate tokens
    const tokens = encode(output);

    // Print final summary
    console.log(chalk.bold("\nOutput Summary:"));
    console.log(
      chalk.green(`✓ Content saved to: ${chalk.bold(config.output.file_name)}`),
    );
    console.log(chalk.green(`✓ Total tokens: ${chalk.bold(tokens.length)}`));
    console.log(); // Empty line at the end
  } catch (error) {
    spinner.fail(chalk.red("Error during repository analysis"));
    if (error instanceof Error) {
      console.error(chalk.red("\nError details:"), error.message);
    }
    process.exit(1);
  }
}

export function initializeCLI(): Command {
  const program = new Command();

  program
    .name("github-context")
    .description("CLI tool to fetch and analyze GitHub repository content")
    .version("1.0.0");

  program
    .command("fetch")
    .description("Fetch and analyze a GitHub repository")
    .argument("<repo-url>", "GitHub repository URL")
    .option("-c, --config <path>", "Path to custom configuration file")
    .option(
      "-o, --output <filename>",
      "Output file name (overrides config file setting)",
    )
    .action(fetchCommand);

  program
    .command("init-config")
    .description("Create a default configuration file in the current directory")
    .action(async () => {
      const defaultConfig = await Bun.file(
        path.join(__dirname, "../config/defaultConfig.yaml"),
      ).text();

      await Bun.write("repo-fetch-config.yaml", defaultConfig);
      console.log(
        chalk.green("✓ Configuration file created: repo-fetch-config.yaml"),
      );
    });

  return program;
}