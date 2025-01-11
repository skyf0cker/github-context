export interface Config {
  include_patterns: {
    readme: string[];
    documentation: string[];
    examples: string[];
    tests: string[];
  };
  exclude_patterns: string[];
  max_file_size: number;
  max_files_per_category: number;
  output: {
    format: 'markdown' | 'json';
    file_name: string;
    include_line_numbers: boolean;
    group_by_category: boolean;
  };
  github: {
    use_auth: boolean;
    token?: string;
  };
}

export interface GitHubContent {
  type: string;
  name: string;
  path: string;
  size: number;
  download_url: string | null;
}

export interface RepoContent {
  readme: string[];
  documentation: string[];
  examples: string[];
  tests: string[];
}
