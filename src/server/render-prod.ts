// @ts-expect-error 這個模組由 vp build --app 產生，乾淨 checkout 尚不存在。
import { renderApp, template } from '../../dist/server/entry-server.js';
import type { HtmlRenderer } from './html.js';

export const prodRenderer: HtmlRenderer = {
  renderApp: async (input) => renderApp(input),
  loadTemplate: async () => template,
};
