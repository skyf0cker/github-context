import type { Config, GitHubContent, RepoContent } from "../types";
import { isExcluded, matchesPatterns } from "../utils/patterns";
import { formatFileContent } from "../utils/formatters";
import ora, { type Ora, type Spinner } from "ora";
import chalk from "chalk";

export class GitHubFetcher {
  private baseApiUrl: string;
  private repoApiUrl: string;
  private config: Config;
  private spinner: Ora | null = null;
  private processedFiles: {
    category: string;
    path: string;
  }[] = [];
  private silent: boolean;

  constructor(
    repoUrl: string,
    config: Config,
    silent: boolean,
    spinner: Ora | null,
  ) {
    this.validateRepoUrl(repoUrl);
    this.baseApiUrl = repoUrl
      .replace("github.com", "api.github.com/repos")
      .replace(/\/$/, "");
    this.repoApiUrl = `${this.baseApiUrl}/contents`;
    this.config = config;
    this.silent = silent;
    this.spinner = spinner;
  }

  private validateRepoUrl(url: string) {
    const githubUrlPattern = /^https?:\/\/github\.com\/[\w-]+\/[\w-]+/;
    if (!githubUrlPattern.test(url)) {
      throw new Error("Invalid GitHub repository URL format");
    }
  }

  private getHeaders(): Headers {
    const headers = new Headers({
      Accept: "application/vnd.github.v3+json",
    });

    if (this.config.github.use_auth) {
      const token = this.config.github.token || process.env.GITHUB_TOKEN;
      if (token) {
        headers.set("Authorization", `token ${token}`);
      }
    }

    return headers;
  }

  private async fetchContent(path: string): Promise<GitHubContent[]> {
    try {
      const response = await fetch(`${this.repoApiUrl}/${path}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`GitHub API responded with ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching ${path}:`, error);
      return [];
    }
  }

  private async fetchFileContent(item: GitHubContent): Promise<string | null> {
    if (!item.download_url || item.size > this.config.max_file_size * 1024) {
      return null;
    }

    try {
      const response = await fetch(item.download_url);
      return await response.text();
    } catch (error) {
      console.error("Error fetching file content:", error);
      return null;
    }
  }

  private getCategoryForFile(path: string): keyof RepoContent | null {
    const categories: (keyof RepoContent)[] = [
      "readme",
      "documentation",
      "examples",
      "tests",
    ];

    for (const category of categories) {
      if (matchesPatterns(path, this.config.include_patterns[category])) {
        return category;
      }
    }

    return null;
  }

  public async fetchRepoContent(): Promise<RepoContent> {
    const content: RepoContent = {
      readme: [],
      documentation: [],
      examples: [],
      tests: [],
    };

    if (this.spinner) this.spinner.start("Analyzing repository structure...");

    const queue = [""];
    const processed = new Set<string>();
    const categoryCount = new Map<keyof RepoContent, number>();

    try {
      while (queue.length > 0) {
        const currentPath = queue.shift()!;
        if (processed.has(currentPath)) continue;
        processed.add(currentPath);

        const items = await this.fetchContent(currentPath);

        for (const item of items) {
          if (this.isExcluded(item.path)) continue;

          if (item.type === "dir") {
            queue.push(item.path);
            continue;
          }

          const category = this.getCategoryForFile(item.path);
          if (!category) continue;

          const currentCount = categoryCount.get(category) || 0;
          if (currentCount >= this.config.max_files_per_category) continue;

          if (this.spinner) this.spinner.text = `Processing: ${item.path}`;

          const fileContent = await this.fetchFileContent(item);
          if (fileContent === null) continue;

          const formattedContent = this.formatFileContent(
            item.path,
            fileContent,
          );
          content[category].push(formattedContent);
          categoryCount.set(category, currentCount + 1);

          this.processedFiles.push({
            category,
            path: item.path,
          });
        }
      }

      if (this.spinner)
        this.spinner.succeed("Repository content processed successfully!");
      if (!this.silent) {
        this.printProcessingSummary();
      }

      return content;
    } catch (error) {
      if (this.spinner)
        this.spinner.fail("Failed to process repository content");
      throw error;
    }
  }

  private isExcluded(path: string): boolean {
    return isExcluded(path, this.config.exclude_patterns);
  }

  private formatFileContent(path: string, content: string): string {
    return formatFileContent(
      path,
      content,
      this.config.output.include_line_numbers,
    );
  }

  private printProcessingSummary() {
    const categories = [
      "readme",
      "documentation",
      "examples",
      "tests",
    ] as const;

    console.log("\n" + chalk.bold("Processing Summary:"));

    categories.forEach((category) => {
      const filesInCategory = this.processedFiles.filter(
        (f) => f.category === category,
      );
      if (filesInCategory.length > 0) {
        console.log(`\n${chalk.cyan(category.toUpperCase())}`);
        filesInCategory.forEach((file) => {
          console.log(chalk.green(`  ✓ ${file.path}`));
        });
      }
    });
    console.log(); // Empty line for spacing
  }
}
