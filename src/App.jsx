import { useState, useEffect, useCallback } from 'react';
import { useApp } from './state/appStore';
import { useProjects } from './hooks/useProjects';
import { useEmails } from './hooks/useEmails';
import { useInvoices } from './hooks/useInvoices';
import sb from './supabaseClient';

// Layout
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Dashboard from './components/layout/Dashboard';
import Settings from './components/layout/Settings';
import LoginScreen from './components/layout/LoginScreen';

// Features
import ProjectList from './components/projects/ProjectList';
import ProjectDetail from './components/projects/ProjectDetailNoticeWorkflow';
import Inbox from './components/email/Inbox';
import EmailComposer from './components/email/EmailComposer';
import MainChat from './components/chat/MainChat';
import AwardReview from './components/awards/AwardReview';
import Calendar from './components/calendar/Calendar';
import Accounting from './components/accounting/Accounting';
import InvoiceModal from './components/accounting/InvoiceModal';
import SOC from './components/soc/SOC';

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
  const { invoices, createInvoice } = useInvoices();

  const [authChecked, setAuthChecked]       = useState(false);
  const getInitialView = () => {
    try {
      return localStorage.getItem('ely_current_view') || 'dashboard';
    } catch {
      return 'dashboard';
    }
  };

  const getInitialProjectId = () => {
    try {
      return localStorage.getItem('ely_current_project_id') || '';
    } catch {
      return '';
    }
  };

  const getInitialPreviousView = () => {
    try {
      const stored = localStorage.getItem('ely_previous_view');
      return stored && stored !== 'chat' ? stored : 'dashboard';
    } catch {
      return 'dashboard';
    }
  };

  const getInitialPreviousProjectId = () => {
    try {
      return localStorage.getItem('ely_previous_project_id') || '';
    } catch {
      return '';
    }
  };

  const [currentView, setCurrentView]       = useState(getInitialView);
  const [previousView, setPreviousView]     = useState(getInitialPreviousView);
  const [projectView, setProjectView]       = useState(null);
  const [pendingProjectId, setPendingProjectId] = useState(getInitialProjectId);
  const [previousProjectId, setPreviousProjectId] = useState(getInitialPreviousProjectId);
  const [sidebarOpen, setSidebarOpen]       = useState(false);
  const [composerOpts, setComposerOpts]     = useState(null);
  const [invoiceProject, setInvoiceProject] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [socProjectId, setSocProjectId]     = useState(null);
  const [socDefaultAOIndex, setSocDefaultAOIndex] = useState(null);

  const nextInvoiceNumber = settings?.next_invoice_number
    || (invoices?.length > 0
      ? Math.max(...invoices.map(i => parseInt(i.invoice_number, 10) || 0)) + 1
      : 1601);

  useEffect(() => {
    if (!sb) { setAuthChecked(true); return; }
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) dispatch({ type: 'SET_USER', payload: session.user });
      setAuthChecked(true);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (session?.user) dispatch({ type: 'SET_USER', payload: session.user });
      else if (event === 'SIGNED_OUT') dispatch({ type: 'SET_USER', payload: null });
    });
    return () => subscription.unsubscribe();
  }, [dispatch]);

  useEffect(() => {
    if (currentUser) {
      loadProjects();
      loadEmails();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    try {
      localStorage.setItem('ely_current_view', currentView || 'dashboard');
    } catch {}
  }, [currentView]);

  useEffect(() => {
    if (!pendingProjectId || !state.projects?.length) return;

    const restoredProject = state.projects.find(p => String(p.id) === String(pendingProjectId));

    if (restoredProject) {
      setProjectView(restoredProject);
      setCurrentProject(restoredProject);
      setCurrentView('projects');
      setPendingProjectId('');
    }
  }, [pendingProjectId, state.projects, setCurrentProject]);

  const rememberPreviousLocation = useCallback(() => {
    const safePreviousView = currentView && currentView !== 'chat'
      ? currentView
      : previousView || 'dashboard';

    const safePreviousProjectId =
      projectView && projectView !== 'new' && projectView !== 'list'
        ? projectView.id
        : pendingProjectId || previousProjectId || '';

    setPreviousView(safePreviousView);
    setPreviousProjectId(safePreviousProjectId || '');

    try {
      localStorage.setItem('ely_previous_view', safePreviousView);

      if (safePreviousProjectId) {
        localStorage.setItem('ely_previous_project_id', safePreviousProjectId);
      } else {
        localStorage.removeItem('ely_previous_project_id');
      }
    } catch {}
  }, [currentView, previousView, projectView, pendingProjectId, previousProjectId]);

  const handleNavigate = useCallback((view) => {
    if (view === 'chat') {
      rememberPreviousLocation();
      setCurrentView('chat');
      setSidebarOpen(false);

      try {
        localStorage.setItem('ely_current_view', 'chat');
      } catch {}

      return;
    }

    setCurrentView(view);
    setProjectView(null);
    setPendingProjectId('');
    clearCurrentProject();
    setSidebarOpen(false);

    try {
      localStorage.setItem('ely_current_view', view);
      localStorage.removeItem('ely_current_project_id');
    } catch {}
  }, [clearCurrentProject, rememberPreviousLocation]);

  const handleOpenProject = useCallback((project) => {
    if (project === 'new') {
      setCurrentView('projects');
      setProjectView('new');
      setPendingProjectId('');

      try {
        localStorage.setItem('ely_current_view', 'projects');
        localStorage.removeItem('ely_current_project_id');
      } catch {}
    } else {
      setCurrentProject(project);
      setProjectView(project);
      setCurrentView('projects');
      setPendingProjectId('');

      try {
        localStorage.setItem('ely_current_view', 'projects');
        localStorage.setItem('ely_current_project_id', project.id);
      } catch {}
    }
  }, [setCurrentProject]);

  const openComposer = useCallback((opts) => {
    setComposerOpts(opts || { mode: 'compose' });
  }, []);

  const closeComposer = useCallback(() => {
    setComposerOpts(null);
  }, []);

  const handleRaiseInvoice = useCallback((projectData = null) => {
    if (projectData) {
      setInvoiceProject(projectData);
      setShowInvoiceModal(true);
      return;
    }

    setInvoiceProject(null);
    setCurrentView('accounting');
    setProjectView(null);
    setPendingProjectId('');

    try {
      localStorage.setItem('ely_current_view', 'accounting');
      localStorage.removeItem('ely_current_project_id');
    } catch {}
  }, []);

  const closeInvoiceModal = useCallback(() => {
    setShowInvoiceModal(false);
    setInvoiceProject(null);
  }, []);

  const handleSaveProjectInvoice = useCallback(async (data) => {
    await createInvoice(data);
  }, [createInvoice]);

  const handleOpenSOC = useCallback((project = null) => {
    setSocProjectId(project?.id || null);

    // If opened from a specific AO card, find that AO's index in the project's aos array
    const targetAO = project?.selectedAO || project?.selected_ao || project?.soc_target_ao || null;
    if (targetAO && Array.isArray(project?.aos) && project.aos.length > 1) {
      const idx = project.aos.findIndex(ao =>
        (ao.id && ao.id === targetAO.id) ||
        (ao.num && ao.num === targetAO.num) ||
        (ao.premise && ao.premise === targetAO.premise)
      );
      setSocDefaultAOIndex(idx >= 0 ? String(idx) : null);
    } else {
      setSocDefaultAOIndex(null);
    }

    setCurrentView('soc');
    setProjectView(null);
    setPendingProjectId('');
    clearCurrentProject();

    try {
      localStorage.setItem('ely_current_view', 'soc');
      localStorage.removeItem('ely_current_project_id');
    } catch {}
  }, [clearCurrentProject]);

  const handleCloseMainChat = useCallback(() => {
    const targetView = previousView && previousView !== 'chat'
      ? previousView
      : 'dashboard';

    setCurrentView(targetView);
    setSidebarOpen(false);

    if (targetView === 'projects' && previousProjectId) {
      const restoredProject = state.projects?.find(
        p => String(p.id) === String(previousProjectId)
      );

      if (restoredProject) {
        setProjectView(restoredProject);
        setCurrentProject(restoredProject);
        setPendingProjectId('');
      } else {
        setProjectView(null);
        setPendingProjectId(previousProjectId);
      }

      try {
        localStorage.setItem('ely_current_view', 'projects');
        localStorage.setItem('ely_current_project_id', previousProjectId);
      } catch {}

      return;
    }

    setProjectView(null);
    setPendingProjectId('');
    clearCurrentProject();

    try {
      localStorage.setItem('ely_current_view', targetView);
      localStorage.removeItem('ely_current_project_id');
    } catch {}
  }, [previousView, previousProjectId, state.projects, setCurrentProject, clearCurrentProject]);

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

  if (!currentUser) {
    return <LoginScreen onLogin={(user) => dispatch({ type: 'SET_USER', payload: user })} />;
  }

  const renderContent = () => {
    if (currentView === 'projects' && projectView && projectView !== 'list' && projectView !== 'new') {
      return (
        <ProjectDetail
          project={projectView}
          onBack={() => {
            setProjectView(null);
            setPendingProjectId('');
            clearCurrentProject();

            try {
              localStorage.setItem('ely_current_view', 'projects');
              localStorage.removeItem('ely_current_project_id');
            } catch {}
          }}
          onOpenComposer={openComposer}
          onRaiseInvoice={handleRaiseInvoice}
          onOpenSOC={handleOpenSOC}
        />
      );
    }

    if (currentView === 'projects' && pendingProjectId && !projectView) {
      return (
        <div style={{ padding: 40, color: 'var(--text3)', fontSize: 13 }}>
          Loading project…
        </div>
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
        return <MainChat onOpenComposer={openComposer} onClose={handleCloseMainChat} />;
      case 'awards':
        return <AwardReview />;
      case 'settings':
        return <Settings onNavigate={handleNavigate} />;
      case 'calendar':
        return <Calendar onOpenProject={handleOpenProject} />;
      case 'accounting':
        return (
          <Accounting
            projects={state.projects || []}
            settings={settings || {}}
          />
        );
      case 'soc':
        return (
          <SOC
            onOpenComposer={openComposer}
            defaultProjectId={socProjectId}
            defaultAOIndex={socDefaultAOIndex}
            key={`${socProjectId}-${socDefaultAOIndex}`}
          />
        );
      case 'leads':
        return <StubView icon="🎯" title="Leads" subtitle="Track and manage incoming enquiries" />;
      case 'contacts':
        return <StubView icon="👥" title="Contacts" subtitle="Surveyors, clients, and solicitors" />;
      case 'notices':
        return <StubView icon="📋" title="Notices" subtitle="Coming soon" />;
      default:
        return <Dashboard onNavigate={handleNavigate} onOpenProject={handleOpenProject} />;
    }
  };

  const appBody = currentView === 'chat' ? (
    <>
      <MainChat onOpenComposer={openComposer} onClose={handleCloseMainChat} />
      {composerOpts && (
        <EmailComposer
          opts={composerOpts}
          onClose={closeComposer}
          onSent={closeComposer}
        />
      )}
      {showInvoiceModal && (
        <InvoiceModal
          initialData={invoiceProject || {}}
          nextNumber={nextInvoiceNumber}
          settings={settings || {}}
          projects={state.projects || []}
          onSave={handleSaveProjectInvoice}
          onEmail={(opts) => {
            setComposerOpts({
              mode: 'compose',
              ...opts,
            });
          }}
          onClose={closeInvoiceModal}
        />
      )}
    </>
  ) : (
    <div className="app">
      <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <div className={`sidebar${sidebarOpen ? ' open' : ''}`} style={{
        width: 216,
        minWidth: 216,
        background: 'var(--bg2)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        overflowY: 'auto',
        transition: 'transform 0.3s',
      }}>
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          onRaiseInvoice={() => handleRaiseInvoice(null)}
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
        <EmailComposer
          opts={composerOpts}
          onClose={closeComposer}
          onSent={closeComposer}
        />
      )}

      {showInvoiceModal && (
        <InvoiceModal
          initialData={invoiceProject || {}}
          nextNumber={nextInvoiceNumber}
          settings={settings || {}}
          projects={state.projects || []}
          onSave={handleSaveProjectInvoice}
          onEmail={(opts) => {
            setComposerOpts({
              mode: 'compose',
              ...opts,
            });
          }}
          onClose={closeInvoiceModal}
        />
      )}
    </div>
  );

  return appBody;
}
