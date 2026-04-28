import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Fonts: loaded via @fontsource so we're not at the mercy of a CDN.
// Display & prose are served at a couple of weights; mono is single weight.
import '@fontsource/gloock/400.css';
import '@fontsource/spectral/300.css';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/700.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500-italic.css';
import '@fontsource/fragment-mono/400.css';
import '@fontsource/fragment-mono/400-italic.css';

import './styles/tokens.css';
import './styles/globals.css';

import { App } from './App';
import { OnboardingGate } from './components/Onboarding/OnboardingGate';
import { startEventStream } from './lib/events';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// The SSE listener bridges server file-watch and job events to Query cache
// invalidations. It lives outside React because there's no component-bound
// reason for it; keeping it global also makes it easier to debug.
startEventStream(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <OnboardingGate>
        <App />
      </OnboardingGate>
    </QueryClientProvider>
  </StrictMode>,
);
