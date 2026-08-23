import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { emitError } from './lib/errorBus';
import './index.css';

// Anything that would otherwise only ever show up in the devtools console
// (a bug, a bad response no one anticipated) still needs to reach the user.
window.addEventListener('error', (e) => emitError(e.message || 'Unexpected error'));
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  emitError(reason instanceof Error ? reason.message : String(reason ?? 'Unexpected error'));
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
