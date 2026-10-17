import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './state/appStore';
import App from './App';
import './index.css';
import { initCrashBreadcrumbs } from './utils/crashBreadcrumbs';

initCrashBreadcrumbs();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
