import {
  type DehydratedState,
  HydrationBoundary,
  QueryClientProvider,
} from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { createQueryClient } from './query-client';
import './styles.css';

const queryClient = createQueryClient();
const dehydratedState = (window as typeof window & { __RQ_STATE__?: DehydratedState }).__RQ_STATE__;

// 禁掉瀏覽器對整個頁面的縮放，只留地圖自己的縮放。iOS Safari 會忽略 viewport
// meta 的 maximum-scale／user-scalable，唯一擋得住的是它自己那組非標準的
// gesture 事件；雙指的 touchmove 也要擋。必須是 passive: false 的原生監聽器。
if (window.matchMedia('(pointer: coarse)').matches) {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  }
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );
}

const root = document.getElementById('root')!;
const tree = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </HydrationBoundary>
    </QueryClientProvider>
  </StrictMode>
);

if (root.childElementCount > 0) hydrateRoot(root, tree);
else createRoot(root).render(tree);
