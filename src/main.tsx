import { initSync } from './utils/syncEngine';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

async function startApp() {
  await initSync();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void startApp();
