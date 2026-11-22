import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './state/appStore';
import App from './App';
import PublicNoticeResponse from './components/notices/PublicNoticeResponse';
import './index.css';
import { initCrashBreadcrumbs } from './utils/crashBreadcrumbs';
import { initUpdateNotice } from './utils/updateNotice';

initCrashBreadcrumbs();
initUpdateNotice();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      {window.location.pathname === '/notice-response-preview' ? <PublicNoticeResponse /> : <App />}
    </AppProvider>
  </React.StrictMode>
);
