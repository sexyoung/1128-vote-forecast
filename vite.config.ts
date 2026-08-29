import { readFile } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite-plus';

function indexHtmlAsModule(): Plugin {
  const specifier = 'virtual:index-html';
  const resolved = `\0${specifier}`;
  return {
    name: 'index-html-as-module',
    applyToEnvironment: (environment) => environment.name === 'ssr',
    resolveId: (source) => (source === specifier ? resolved : null),
    async load(source) {
      if (source !== resolved) return null;
      const html = await readFile('dist/client/index.html', 'utf8');
      return `export const template = ${JSON.stringify(html)};`;
    },
  };
}

export default defineConfig({
  appType: 'spa',
  plugins: [react(), tailwindcss(), indexHtmlAsModule()],
  server: {
    host: '0.0.0.0',
    // cloudflared 的快速通道會帶著 *.trycloudflare.com 的 Host 進來，不放行的話
    // Vite 會直接回 Blocked request，手機上只看得到一片空白。
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  builder: {},
  environments: {
    // 順序不可換：SSR build 會把 client build 剛產生的 index.html 烤進 bundle。
    client: {
      build: {
        outDir: 'dist/client',
        rollupOptions: { input: 'index.html' },
      },
    },
    ssr: {
      build: {
        outDir: 'dist/server',
        ssr: 'src/client/entry-server.tsx',
        copyPublicDir: false,
      },
    },
  },
  lint: {
    plugins: ['typescript', 'react'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    singleQuote: true,
    semi: true,
    // election-contests.json 是 npm run data:contests 產生的，一列一個選區是刻意
    // 的：8,429 筆縮排開來 2 MB，diff 也讀不動。
    ignorePatterns: ['.claude/**', '.devcontainer/**', 'src/server/data/**'],
  },
  test: { environment: 'node' },
});
