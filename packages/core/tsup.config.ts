import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  // Mark all dependencies and Node built-ins as external to avoid
  // bundling CJS-only packages (like whatwg-url/punycode) into the ESM output.
  noExternal: [],
  external: [
    'openai',
    'node-fetch',
    'whatwg-url',
    'yaml',
    'dotenv',
    'axios',
    '@dsca/tools',
  ],
});
