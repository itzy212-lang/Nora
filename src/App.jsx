import { useState, useEffect, useCallback } from 'react';
import { useApp } from './state/appStore';
import { useProjects } from './hooks/useProjects';
import { useEmails } from './hooks/useEmails';
import sb from './supabaseClient';

// Layout
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Dashboard from './components/layout/Dashboard';
import Settings from './components/layout/Settings';
import LoginScreen from './components/layout/LoginScreen';

// Features
import ProjectList from './components/projects/ProjectList';
import ProjectDetail from './components/projects/ProjectDetail';
import Inbox from './components/email/Inbox';
import EmailComposer from './components/email/EmailComposer';
import MainChat from './components/chat/MainChat';
import AwardReview from './components/awards/AwardReview';
import Calendar from './components/calendar/Calendar';

// Stub views
function StubView({ icon, title, subtitle }) {
  return (
    <div className="empty" style={{ padding: '60px 20px' }}>
      <div className="empty-icon">{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{subtitle || 'Coming soon'}</div>
    </div>
  );
}

export default function App() {
  const { state, dispatch } = useApp();
  const { currentUser, settings } = state;
  const { loadProjects, setCurrentProject, clearCurrentProject } = useProjects();
  const { loadEmails } = useEmails();

  const [authChecked, setAuthChecked] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard');
  const [projectView, setProjectView] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [composerOpts, setComposerOpts] = useState(null);

  // Auth
  useEffect(() => {
    if (!sb) { setAuthChecked(true); return; }

    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        dispatch({ type: 'SET_USER', payload: session.user });
      }
      setAuthChecked(true);
    });

    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        dispatch({ type: 'SET_USER', payload: session.user });
      } else if (event === 'SIGNED_OUT') {
        dispatch({ type: 'SET_USER', payload: null });
      }
    });

    return () => subscription.unsubscribe();
  }, [dispatch]);

  // Load data on auth
  useEffect(() => {
    if (currentUser) {
      loadProjects();
      loadEmails();
    }
  }, [currentUser?.id]);

  const handleNavigate = useCallback((view) => {
    setCurrentView(view);
    setProjectView(null);
    clearCurrentProject();
    setSidebarOpen(false);
  }, [clearCurrentProject]);

  const handleOpenProject = useCallback((project) => {
    if (project === 'new') {
      setCurrentView('projects');
      setProjectView('new');
    } else {
      setCurrentProject(project);
      setProjectView(project);
      setCurrentView('projects');
    }
  }, [setCurrentProject]);

  const openComposer  = useCallback((opts) => setComposerOpts(opts || { mode: 'compose' }), []);
  const closeComposer = useCallback(() => setComposerOpts(null), []);

  // Loading
  if (!authChecked) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 auto 12px' }}>E</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</div>
        </div>
      </div>
    );
  }

  // Login gate
  if (!currentUser) {
    return <LoginScreen onLogin={(user) => dispatch({ type: 'SET_USER', payload: user })} />;
  }

  const renderContent = () => {
    // Project detail view
    if (currentView === 'projects' && projectView && projectView !== 'list' && projectView !== 'new') {
      return (
        <ProjectDetail
          project={projectView}
          onBack={() => { setProjectView(null); clearCurrentProject(); }}
          onOpenComposer={openComposer}
        />
      );
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} onOpenProject={handleOpenProject} />;
      case 'projects':
        return <ProjectList onOpenProject={handleOpenProject} />;
      case 'inbox':
        return <Inbox onOpenComposer={openComposer} />;
      case 'chat':
        return <MainChat onOpenComposer={openComposer} />;
      case 'awards':
        return <AwardReview />;
      case 'settings':
        return <Settings onNavigate={handleNavigate} />;
      case 'calendar':
        return <Calendar onOpenProject={handleOpenProject} />;
      case 'leads':
        return <StubView icon="🎯" title="Leads" subtitle="Track and manage incoming enquiries" />;
      case 'contacts':
        return <StubView icon="👥" title="Contacts" subtitle="Surveyors, clients, and solicitors" />;
      case 'soc':
        return <StubView icon="🎙" title="SOC Dictation" subtitle="Record and transcribe schedules of condition" />;
      case 'notices':
        return <StubView icon="📋" title="Notices" subtitle="Draft and manage party wall notices" />;
      case 'invoices':
        return <StubView icon="💰" title="Invoices" subtitle="Billing and fee management" />;
      default:
        return <Dashboard onNavigate={handleNavigate} onOpenProject={handleOpenProject} />;
    }
  };

  // Chat view is full-screen — no shell
  if (currentView === 'chat') {
    return (
      <>
        <MainChat onOpenComposer={openComposer} />
        {composerOpts && (
          <EmailComposer opts={composerOpts} onClose={closeComposer} onSent={closeComposer} />
        )}
      </>
    );
  }

  return (
    <div className="app">
      <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <div className={`sidebar${sidebarOpen ? ' open' : ''}`} style={{
        width: 216, minWidth: 216, background: 'var(--bg2)',
        borderRight: '1px solid var(--border)', display: 'flex',
        flexDirection: 'column', zIndex: 50, overflowY: 'auto', transition: 'transform 0.3s',
      }}>
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="main">
        <TopBar
          currentView={currentView}
          onMenuToggle={() => setSidebarOpen(v => !v)}
          onNavigate={handleNavigate}
        />
        <div className="content">
          {renderContent()}
        </div>
      </div>

      {composerOpts && (
        <EmailComposer opts={composerOpts} onClose={closeComposer} onSent={closeComposer} />
      )}
    </div>
  );
}
