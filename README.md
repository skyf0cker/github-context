# GitHub Context

A CLI tool to fetch and analyze GitHub repository content, optimized for providing context to Large Language Models (LLMs).

## Features

- 📂 Fetch repository content based on configurable patterns
- 🎯 Smart filtering of relevant files and directories
- 📝 Customizable output formatting
- 🔢 Token counting for LLM context optimization
- ⚙️ Flexible configuration system
- 🚀 Built with Bun for high performance

## Installation

```bash
# Install globally
bun install -g github-context

# Or run directly with bun
bun install
```

## Usage

### Basic Command

```bash
# Fetch repository content
github-context fetch https://github.com/username/repo

# Use custom config file
github-context fetch https://github.com/username/repo -c ./my-config.yaml

# Specify custom output file
github-context fetch https://github.com/username/repo -o output.md
```

### Initialize Configuration

Create a default configuration file in your current directory:

```bash
github-context init-config
```

## Configuration

The tool uses a YAML configuration file to customize its behavior. You can create a default configuration file using the `init-config` command or specify a custom one using the `-c` flag.

### Default Configuration Structure

```yaml
include_patterns:
  readme:
    - "README.md"
    - "README.txt"
  documentation:
    - "docs/**/*.md"
    - "documentation/**/*"
    # ... more patterns

exclude_patterns:
  - "node_modules/**/*"
  - "dist/**/*"
  # ... more patterns

max_file_size: 500
max_files_per_category: 50

output:
  format: "markdown"
  file_name: "repo_content.md"
  include_line_numbers: true
  group_by_category: true
```

## Command Line Options

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to custom configuration file |
| `-o, --output <filename>` | Output file name (overrides config setting) |
| `-h, --help` | Display help information |
| `-V, --version` | Display version number |

## Output

The tool generates a formatted Markdown file containing:
- Repository content organized by categories
- File content with optional line numbers
- Token count summary for LLM context sizing

## Development

```bash
# Run locally
bun start

# Build for distribution
bun run build
```

## Dependencies

- [commander](https://github.com/tj/commander.js) - Command line interface
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [ora](https://github.com/sindresorhus/ora) - Elegant terminal spinners
- [gpt-tokenizer](https://github.com/latitudegames/gpt-tokenizer) - Token counting
- [yaml](https://github.com/eemeli/yaml) - YAML parsing

## License

MIT

## Author

14m4r (<dev@vophan.day>)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
```

This README provides a comprehensive overview of your project, including:
- Project description and features
- Installation instructions
- Usage examples
- Configuration details
- Command line options
- Development instructions
- Dependencies
- License and contribution guidelines

You can customize it further based on your specific needs or add more sections as your project evolves.
