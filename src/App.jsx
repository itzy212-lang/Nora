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
import BriefingChat from './components/layout/BriefingChat';
import { registerPushNotifications } from './hooks/usePushNotifications';
import Calendar from './components/calendar/Calendar';
import Accounting from './components/accounting/Accounting';
import InvoiceModal from './components/accounting/InvoiceModal';
import Contacts from './components/shared/Contacts';
import Leads from './components/shared/Leads';
import SOC from './components/soc/SOC';
import DisputeAgreement from './components/dispute/DisputeAgreement';
import DisputeResolution from './components/projects/DisputeResolution';
import PartyWallLeadQuote from './components/shared/PartyWallLeadQuote';
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
  // Fixed 2026-08-17: loadEmails itself is no longer called from here
  // (see the removed call in the login effect below) — only
  // loadMoreEmails (pagination) and the loading-state flags are
  // actually used in this file now.
  const { loadMoreEmails, loadingMore, hasMoreEmails } = useEmails();
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
  // Added 2026-08-28: holds Inbox.jsx's own overlay-close function
  // when one of its internal overlays (reply, Draft with Nora) is
  // open — see Inbox.jsx's onOverlayChange for the full reasoning.
  const [inboxOverlayClose, setInboxOverlayClose] = useState(null);
  // Added 2026-09-03, on request: hide the top bar's own 'Ask Nora'
  // button whenever the user is already inside a Nora chat surface
  // (Project Chat's own tab, or Draft with Nora, covered separately
  // via isOverlayOpen) — reported as redundant clutter, squashing
  // the top bar, since a second way to open the same kind of chat is
  // already right there.
  const [projectActiveTab, setProjectActiveTab] = useState(null);
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
      // Fixed 2026-08-17: real, confirmed bug — this fired a
      // completely separate, older, simpler loadEmails (from
      // useEmails.js: flat 'fetch 300, replace everything', no cache
      // awareness) at the same time Inbox.jsx runs its own newer,
      // proper cache-and-incremental system. Both wrote to the same
      // shared state independently, racing each other with no
      // coordination — whichever finished last won, which is exactly
      // what caused 'sometimes shows old cached content, sometimes
      // briefly blank, sometimes correct' on refresh. Inbox.jsx's own
      // system already handles the initial load properly (including
      // showing cached data instantly); this duplicate call is
      // removed, not replaced.

      // Register push notifications after login (deferred so it doesn't block)
      setTimeout(() => registerPushNotifications(currentUser.email), 3000);

      // Handle deep link: ?project=PROJECT_ID (from push notification tap)
      const params = new URLSearchParams(window.location.search);
      const deepProjectId = params.get('project');
      const deepEmailId = params.get('email');

      if (deepProjectId || deepEmailId) {
        window.history.replaceState({}, '', window.location.pathname);

        if (deepProjectId) {
          const openDeepProject = () => {
            const { projects } = useApp.getState?.() || {};
            const proj = (projects || []).find(p => p.id === deepProjectId);
            if (proj) {
              dispatch({ type: 'SET_CURRENT_PROJECT', payload: proj });
              setCurrentView('projects');
              window.scrollTo(0, 0);
            }
          };
          setTimeout(openDeepProject, 1500);
        }

        if (deepEmailId) {
          // Navigate to inbox and highlight the email
          setTimeout(() => {
            dispatch({ type: 'SET_SELECTED_EMAIL_ID', payload: deepEmailId });
            setCurrentView('inbox');
            window.scrollTo(0, 0);
          }, 1500);
        }
      }
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
    // Fixed 2026-08-28, real, confirmed root cause, reported live:
    // 'burger menu doesn't work' once a composer/reply is open. It
    // was never actually broken — handleNavigate genuinely does
    // change currentView every time. The composer just never closes
    // when navigating away, since it renders independently based on
    // composerOpts, not currentView — so it stayed visually on top
    // of whatever view was navigated to, making it look like nothing
    // happened. This is also the direct fix for 'no way to close
    // reply/reply all and go back to inbox' — the burger menu is
    // meant to be exactly that fallback, per the existing sidebar
    // z-index comment, but couldn't be while this stayed open.
    setComposerOpts(null);

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
    window.scrollTo(0, 0);

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
      window.scrollTo(0, 0);

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
        setProjectActiveTab(null);
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

      // Added 2026-08-21, on request: party wall leads don't get the
      // full notice/AO workflow — just the fee entry screen, matching
      // the confirmed mockup. PM leads deliberately aren't handled
      // here — PMProjectDetail's own scope-of-works/quote system
      // already works correctly for a lead, no separate view needed.
      if (projectView.stage === 'lead' && (!projectView.project_type || projectView.project_type === 'party_wall')) {
        return (
          <ErrorBoundary key={projectView?.id}>
            <PartyWallLeadQuote
              project={projectView}
              onBack={onBack}
              onProjectUpdated={(patch) => setProjectView(prev => ({ ...prev, ...patch }))}
              onAccept={async () => {
                if (!window.confirm('Accept this quote and make it a live party wall job?')) return;
                await sb.from('projects').update({ stage: 'live' }).eq('id', projectView.id);
                onBack();
              }}
            />
          </ErrorBoundary>
        );
      }

      // Fixed 2026-08-14, on request: standalone Dispute projects
      // render the dispute-resolution workspace directly, not the
      // normal party wall/construction ProjectDetail — this is the
      // one and only place DisputeResolution.jsx now gets rendered
      // from; previously it was only ever imported by
      // PMProjectDetailEnhanced.jsx, which itself was never rendered
      // anywhere, making the whole workspace unreachable.
      if (projectView?.project_type === 'dispute') {
        return (
          <ErrorBoundary key={projectView?.id}>
            <DisputeResolution project={projectView} onBack={onBack} onRaiseInvoice={handleRaiseInvoice} />
          </ErrorBoundary>
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
            onActiveTabChange={setProjectActiveTab}
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
      case 'briefing':
        return <BriefingChat onBack={() => handleNavigate('dashboard')} onOpenProject={handleOpenProject} onOpenComposer={(opts) => { setComposerOpts(opts); }} />;
      case 'projects':
        return <ProjectList onOpenProject={handleOpenProject} />;
      case 'inbox':
        return <Inbox onOpenComposer={openComposer} onNavigate={handleNavigate} resetKey={inboxResetKey} onLoadMore={loadMoreEmails} loadingMore={loadingMore} hasMore={hasMoreEmails} onOverlayChange={(isOpen, closeFn) => setInboxOverlayClose(isOpen ? () => closeFn : null)} />;
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
        return <Leads onOpenProject={handleOpenProject} />;
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
      <TopBar
        currentView={currentView}
        onMenuToggle={() => setSidebarOpen(v => !v)}
        onNavigate={handleNavigate}
        onOpenNotepad={() => setShowNotepad(true)}
        onOpenQuickRef={() => setShowQuickRef(true)}
        isOverlayOpen={!!composerOpts || !!inboxOverlayClose}
        onCloseOverlay={() => {
          setComposerOpts(null);
          if (inboxOverlayClose) inboxOverlayClose();
        }}
        hideAskNora={currentView === 'projects' && projectActiveTab === 'chat'}
      />

      <div className="app-body">
        <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
        <div className={`sidebar${sidebarOpen ? ' open' : ''}`} style={{ width: 216, minWidth: 216, background: 'var(--bg2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', zIndex: 500, overflowY: 'auto', transition: 'transform 0.3s' }}>
          <Sidebar currentView={currentView} onNavigate={handleNavigate} onRaiseInvoice={() => handleRaiseInvoice(null)} onClose={() => setSidebarOpen(false)} />
        </div>
        <div className="main">
          <div className="content">
            {renderContent()}
          </div>
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



