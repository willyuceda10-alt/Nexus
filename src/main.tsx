import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initializeBridataMsal } from './auth/msalBridata';
import { runtimeConfig } from './config/runtime';
import './index.css';

async function bootstrap(): Promise<void> {
  if (runtimeConfig.authMode === 'entra' && runtimeConfig.entraConfigured) {
    try {
      await initializeBridataMsal();
    } catch (error) {
      console.error('Bridata MSAL initialization failed.', error);
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
