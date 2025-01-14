import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export default {
  input: 'src/bin/cli.ts',
  output: [
    {
      file: 'dist/cli.js',
      format: 'esm',
      sourcemap: true,
      banner: '#!/usr/bin/env node',
    },
  ],
  external: [
    // List external dependencies that shouldn't be bundled
    'chalk',
    'commander',
    'gpt-tokenizer',
    'minimatch',
    'ora',
    'yaml',
    'bun', // Add bun as an external dependency
  ],
  plugins: [
    resolve({
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      noEmit: false, // Ensure noEmit is false for Rollup
    }),
    {
      name: 'copy-config',
      writeBundle() {
        // 确保目标目录存在
        const configDir = join('dist', 'config');
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }
        // 复制配置文件
        copyFileSync(
          join('src', 'config', 'defaultConfig.yaml'),
          join('dist', 'config', 'defaultConfig.yaml')
        );
      },
    },
  ],
};
