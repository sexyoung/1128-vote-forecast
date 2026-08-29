import { HydrationBoundary, QueryClientProvider, dehydrate } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { App } from './App';
import { createQueryClient } from './query-client';

export type QuerySeed = { key: unknown[]; data: unknown; updatedAt: number };

export function renderApp({ url, seeds }: { url: string; seeds: QuerySeed[] }) {
  const queryClient = createQueryClient();
  for (const seed of seeds) {
    queryClient.setQueryData(seed.key, seed.data, { updatedAt: seed.updatedAt });
  }

  const dehydratedState = dehydrate(queryClient);
  const appHtml = renderToString(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <StaticRouter location={url}>
            <App />
          </StaticRouter>
        </HydrationBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );

  return {
    appHtml,
    stateJson: JSON.stringify(dehydratedState).replace(/</g, '\\u003c'),
  };
}

export { template } from 'virtual:index-html';
