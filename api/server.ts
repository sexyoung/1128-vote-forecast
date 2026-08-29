import { app } from '../src/server/app.js';
import { assertProductionEnv } from '../src/server/env.js';
import { mountHtmlRoutes } from '../src/server/html.js';
import { prodRenderer } from '../src/server/render-prod.js';

assertProductionEnv();
mountHtmlRoutes(app, prodRenderer);

export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.searchParams.get('__vf_path');
    if (!path) return app.fetch(request);

    url.pathname = path;
    url.searchParams.delete('__vf_path');
    return app.fetch(new Request(url, request));
  },
};
