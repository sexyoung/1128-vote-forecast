import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // cloudflared 的快速通道會帶著 *.trycloudflare.com 的 Host 進來，不放行的話
    // Vite 會直接回 Blocked request，手機上只看得到一片空白。
    allowedHosts: ['.trycloudflare.com'],
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
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
