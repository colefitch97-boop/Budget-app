/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const require = createRequire(import.meta.url);

// In the artifact build, React comes from the cdnjs UMD scripts that
// scripts/build-artifact.mjs adds to the page, so each import of these
// modules resolves to the matching window global instead of a bundled copy.
const CDN_GLOBALS: Record<string, string> = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
};

function cdnGlobals(): Plugin {
  const prefix = '\0cdn-global:';
  return {
    name: 'cdn-globals',
    enforce: 'pre',
    resolveId(id) {
      return id in CDN_GLOBALS ? prefix + id : null;
    },
    load(id) {
      if (!id.startsWith(prefix)) return null;
      const mod = id.slice(prefix.length);
      const names = Object.keys(require(mod)).filter(
        (n) => n !== 'default' && /^[A-Za-z_$][\w$]*$/.test(n),
      );
      return [
        `const m = window.${CDN_GLOBALS[mod]};`,
        'export default m;',
        ...names.map((n) => `export const ${n} = m.${n};`),
      ].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => ({
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    jsxInject: `import React from 'react'`,
  },
  plugins: mode === 'artifact' ? [cdnGlobals(), viteSingleFile()] : [],
  build: {
    outDir: mode === 'artifact' ? 'artifact/build' : 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
