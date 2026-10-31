import { defineConfig } from 'tsup'
export default defineConfig({ entry: ['src/index.ts'], format: ['esm', 'cjs'], target: 'node22', sourcemap: true, clean: true, external: ['@anyframe/core/node', 'fflate'] })
