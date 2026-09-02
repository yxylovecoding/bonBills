import { useMonthlyStore } from './stores/monthlyStore';
import { initSync, triggerUpload } from './utils/syncEngine';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

async function startApp() {
  await initSync();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (useMonthlyStore.getState().ensureInvestmentMonth(yearMonth)) {
    await triggerUpload();
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void startApp();
