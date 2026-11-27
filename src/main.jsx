import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './state/appStore';
import App from './App';
import PublicNoticeResponse from './components/notices/PublicNoticeResponse';
import PublicNoticeRoute from './components/notices/PublicNoticeRoute';
import PublicLOASigning from './components/loa/PublicLOASigning';
import './index.css';
import { initCrashBreadcrumbs } from './utils/crashBreadcrumbs';
import { initUpdateNotice } from './utils/updateNotice';
import { installApiAuth } from './utils/apiAuth';

installApiAuth();
initCrashBreadcrumbs();
initUpdateNotice();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      {window.location.pathname.startsWith('/loa/sign/') ? <PublicLOASigning /> : window.location.pathname.startsWith('/respond/') ? <PublicNoticeRoute /> : window.location.pathname === '/notice-response-preview' ? <PublicNoticeResponse /> : <App />}
    </AppProvider>
  </React.StrictMode>
);
