import React, { useState, useEffect, useCallback } from 'react';
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
import SplashScreen from './components/layout/SplashScreen';

// Features
import ProjectList from './components/projects/ProjectList';
import ProjectDetail from './components/projects/ProjectDetailNoticeWorkflow';
import PMProjectDetail from './components/projects/PMProjectDetail';
import Inbox from './components/email/Inbox';
import EmailComposer from './components/email/EmailComposer';
import MainChat from './components/chat/MainChat';
import AwardReview from './components/awards/AwardReview';
import Calendar from './components/calendar/Calendar';
import Accounting from './components/accounting/Accounting';
import InvoiceModal from './components/accounting/InvoiceModal';
import Contacts from './components/shared/Contacts';
import Leads from './components/shared/Leads';
import SOC from './components/soc/SOC';
import DisputeAgreement from './components/dispute/DisputeAgreement';
import NotepadOverlay from './components/shared/NotepadOverlay';
import DebugPayloadViewer from './components/shared/DebugPayloadViewer';
import QuickRefOverlay from './components/shared/QuickRefOverlay';

function StubView({ icon, title, subtitle }) {
  return (
    <div className="empty" style={{ padding: '60px 20px' }}>
      <div className="empty-icon">{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{subtitle || 'Coming soon'}</div>
    </div>
  );
}


class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, margin: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, fontFamily: 'monospace', fontSize: 12 }}>
          <strong style={{ color: '#ef4444' }}>Error — screenshot this and report:</strong>
          <pre style={{ color: '#7f1d1d', whiteSpace: 'pre-wrap', marginTop: 8 }}>{this.state.error.message}\n\n{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
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
      return sessionStorage.getItem('ely_current_view') || 'dashboard';
    } catch {
      return 'dashboard';
    }
  };

  const getInitialProjectId = () => {
    try {
      return sessionStorage.getItem('ely_current_project_id') || '';
    } catch {
      return '';
    }
  };

  const getInitialPreviousView = () => {
    try {
      const stored = sessionStorage.getItem('ely_previous_view');
      return stored && stored !== 'chat' ? stored : 'dashboard';
    } catch {
      return 'dashboard';
    }
  };

  const getInitialPreviousProjectId = () => {
    try {
      return sessionStorage.getItem('ely_previous_project_id') || '';
    } catch {
      return '';
    }
  };

  const [currentView, setCurrentView]       = useState(getInitialView);
  const [inboxResetKey, setInboxResetKey] = useState(0);
  const [previousView, setPreviousView]     = useState(getInitialPreviousView);
  const [projectView, setProjectView]       = useState(null);
  const [pendingProjectId, setPendingProjectId] = useState(getInitialProjectId);
  const [previousProjectId, setPreviousProjectId] = useState(getInitialPreviousProjectId);
  const [sidebarOpen, setSidebarOpen]       = useState(false);
  const [composerOpts, setComposerOpts]     = useState(null);
  const [invoiceProject, setInvoiceProject] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showNotepad, setShowNotepad]        = useState(false);
  const [showQuickRef, setShowQuickRef]      = useState(false);
  const [socProjectId, setSocProjectId]     = useState(null);
  const [socDefaultAOIndex, setSocDefaultAOIndex] = useState(null);
  const [disputeProjectId, setDisputeProjectId] = useState(null);

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
      // Load leads into global state for dashboard
      sb.from('leads').select('*').order('created_at', { ascending: false }).then(({ data }) => {
        if (data) dispatch({ type: 'SET_LEADS', payload: data });
      });
    }
  }, [currentUser?.id]);

  useEffect(() => {
    try {
      sessionStorage.setItem('ely_current_view', currentView || 'dashboard');
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
      sessionStorage.setItem('ely_previous_view', safePreviousView);

      if (safePreviousProjectId) {
        sessionStorage.setItem('ely_previous_project_id', safePreviousProjectId);
      } else {
        sessionStorage.removeItem('ely_previous_project_id');
      }
    } catch {}
  }, [currentView, previousView, projectView, pendingProjectId, previousProjectId]);

  const handleNavigate = useCallback((view) => {
    if (view === 'chat') {
      rememberPreviousLocation();
      setCurrentView('chat');
      setSidebarOpen(false);

      try {
        sessionStorage.setItem('ely_current_view', 'chat');
      } catch {}

      return;
    }

    // Re-clicking "Inbox" while already on Inbox is otherwise a no-op (state
    // doesn't change, so the component never resets) — this leaves an open
    // email/reply stuck on screen with no way back except a full refresh.
    // Bumping inboxResetKey lets Inbox.jsx detect "navigated back to me" and
    // clear its own selected-email state without losing the loaded list.
    if (view === 'inbox' && currentView === 'inbox') {
      setInboxResetKey(k => k + 1);
      setSidebarOpen(false);
      return;
    }

    setCurrentView(view);
    setProjectView(null);
    setPendingProjectId('');
    clearCurrentProject();
    setSidebarOpen(false);

    try {
      sessionStorage.setItem('ely_current_view', view);
      sessionStorage.removeItem('ely_current_project_id');
    } catch {}
  }, [clearCurrentProject, rememberPreviousLocation, currentView]);

  const handleOpenProject = useCallback((project) => {
    if (project === 'new') {
      setCurrentView('projects');
      setProjectView('new');
      setPendingProjectId('');

      try {
        sessionStorage.setItem('ely_current_view', 'projects');
        sessionStorage.removeItem('ely_current_project_id');
      } catch {}
    } else {
      setCurrentProject(project);
      setProjectView(project);
      setCurrentView('projects');
      setPendingProjectId('');

      try {
        sessionStorage.setItem('ely_current_view', 'projects');
        sessionStorage.setItem('ely_current_project_id', project.id);
      } catch {}
    }
  }, [setCurrentProject]);

  const openComposer = useCallback((opts) => {
    if (opts?.body && typeof opts.body === 'string' && !opts.body.trim().startsWith('<')) {
      // Convert plain text to HTML paragraphs — centralised fix for all composer paths
      opts = {
        ...opts,
        body: opts.body
          .split(/\n\n+/)
          .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
          .join(''),
      };
    }
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
      sessionStorage.setItem('ely_current_view', 'accounting');
      sessionStorage.removeItem('ely_current_project_id');
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

    // SOC lives within the project — set projectView to 'soc' so back returns to project
    setProjectView('soc');
    setCurrentView('projects');

    try {
      sessionStorage.setItem('ely_current_view', 'projects');
    } catch {}
  }, []);

  const handleOpenDisputeAgreement = useCallback((project = null) => {
    setDisputeProjectId(project?.id || null);
    setCurrentView('dispute');
    setProjectView(null);
    setPendingProjectId('');
    clearCurrentProject();
    try {
      sessionStorage.setItem('ely_current_view', 'dispute');
      sessionStorage.removeItem('ely_current_project_id');
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
        sessionStorage.setItem('ely_current_view', 'projects');
        sessionStorage.setItem('ely_current_project_id', previousProjectId);
      } catch {}

      return;
    }

    setProjectView(null);
    setPendingProjectId('');
    clearCurrentProject();

    try {
      sessionStorage.setItem('ely_current_view', targetView);
      sessionStorage.removeItem('ely_current_project_id');
    } catch {}
  }, [previousView, previousProjectId, state.projects, setCurrentProject, clearCurrentProject]);

  const [splashDone, setSplashDone] = useState(false);

  if (!authChecked || !splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={(user) => dispatch({ type: 'SET_USER', payload: user })} />;
  }

  const renderContent = () => {
    if (currentView === 'projects' && projectView === 'soc') {
      return (
        <SOC
          onOpenComposer={openComposer}
          defaultProjectId={socProjectId}
          defaultAOIndex={socDefaultAOIndex}
          key={`${socProjectId}-${socDefaultAOIndex}`}
          onBack={() => {
            // Return to the project detail — reload the project
            setPendingProjectId(socProjectId);
            setProjectView(null);
            try {
              sessionStorage.setItem('ely_current_view', 'projects');
              if (socProjectId) sessionStorage.setItem('ely_current_project_id', socProjectId);
            } catch {}
          }}
        />
      );
    }

    if (currentView === 'projects' && projectView && projectView !== 'list' && projectView !== 'new') {
      const onBack = () => {
        setProjectView(null);
        setPendingProjectId('');
        clearCurrentProject();
        try {
          sessionStorage.setItem('ely_current_view', 'projects');
          sessionStorage.removeItem('ely_current_project_id');
        } catch {}
      };

      // PM / Construction projects get their own detail view
      if (projectView.project_type === 'construction' || projectView.project_type === 'pm') {
        return (
          <PMProjectDetail
            project={projectView}
            onBack={onBack}
            onOpenComposer={openComposer}
          />
        );
      }

      return (
        <ErrorBoundary key={projectView?.id}>
          <ProjectDetail
            project={projectView}
            onBack={onBack}
            onOpenComposer={openComposer}
            onRaiseInvoice={handleRaiseInvoice}
            onOpenSOC={handleOpenSOC}
            onOpenDisputeAgreement={handleOpenDisputeAgreement}
          />
        </ErrorBoundary>
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
        return <Inbox onOpenComposer={openComposer} onNavigate={handleNavigate} resetKey={inboxResetKey} />;
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
            onOpenComposer={(opts) => { setComposerOpts(opts); }}
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
      case 'dispute':
        return (
          <DisputeAgreement
            onOpenComposer={openComposer}
            defaultProjectId={disputeProjectId}
            key={disputeProjectId}
          />
        );
      case 'leads':
        return <Leads />;
      case 'contacts':
        return <Contacts />;
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
        // Inline style was hardcoded to 50 and silently overrode the .sidebar
        // CSS class's z-index (raised to 500 so the sidebar sits above
        // overlays like the composer) — inline styles always win over class
        // rules, so the sidebar was still rendering at 50 in practice, behind
        // the backdrop overlay (z-index 499), which made it look open but
        // swallow every tap. Now matches the CSS class.
        zIndex: 500,
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
          onOpenNotepad={() => setShowNotepad(true)}
          onOpenQuickRef={() => setShowQuickRef(true)}
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

  return (
    <>
      {appBody}
      {showNotepad && <NotepadOverlay onClose={() => setShowNotepad(false)} />}
      {showQuickRef && <QuickRefOverlay onClose={() => setShowQuickRef(false)} />}
    </>
  );
}



