import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

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
  ],
};
