import { useState } from 'react';
import { useApp } from '../../state/appStore';
import Sidebar from '../layout/Sidebar';
import Dashboard from '../layout/Dashboard';
import Settings from '../layout/Settings';
import ProjectList from '../projects/ProjectList';
import ProjectDetail from '../projects/ProjectDetailNoticeWorkflow';
import Inbox from '../email/Inbox';
import Calendar from '../calendar/Calendar';
import Accounting from '../accounting/Accounting';
import Contacts from '../shared/Contacts';
import Leads from '../shared/Leads';

const EXCLUDED = new Set(['chat', 'soc']);

export default function QuickRefOverlay({ onClose }) {
  const [overlayView, setOverlayView] = useState('dashboard');
  const [overlayProject, setOverlayProject] = useState(null);
  const { state } = useApp();

  const handleNavigate = (view) => {
    if (EXCLUDED.has(view)) return;
    setOverlayProject(null);
    setOverlayView(view);
  };

  const handleOpenProject = (project) => {
    if (!project) return;
    setOverlayProject(project);
    setOverlayView('project');
  };

  const renderContent = () => {
    switch (overlayView) {
      case 'dashboard':
        return (
          <Dashboard
            onNavigate={handleNavigate}
            onOpenProject={handleOpenProject}
          />
        );
      case 'projects':
        return (
          <ProjectList
            onOpenProject={handleOpenProject}
          />
        );
      case 'project':
        return overlayProject ? (
          <ProjectDetail
            project={overlayProject}
            onOpenComposer={() => {}}
            onClose={() => { setOverlayProject(null); setOverlayView('projects'); }}
          />
        ) : (
          <ProjectList onOpenProject={handleOpenProject} />
        );
      case 'inbox':
        return <Inbox onOpenComposer={() => {}} />;
      case 'calendar':
        return <Calendar />;
      case 'leads':
        return <Leads />;
      case 'contacts':
        return <Contacts />;
      case 'accounting':
        return <Accounting />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onNavigate={handleNavigate} onOpenProject={handleOpenProject} />;
    }
  };

  const activeView = overlayView === 'project' ? 'projects' : overlayView;

  return (
    <>
      {/* Blurred backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15,23,42,0.45)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 8000,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(82vw, 1200px)',
          height: '85vh',
          zIndex: 8001,
          display: 'flex',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07)',
          animation: 'qrSlideIn 0.2s ease',
        }}
      >
        <style>{`
          @keyframes qrSlideIn {
            from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}</style>

        {/* Sidebar */}
        <div style={{
          width: 210,
          minWidth: 210,
          background: 'var(--bg2)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          position: 'relative',
        }}>
          {/* Close button */}
          <button
            onClick={onClose}
            title="Close quick view"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 26,
              height: 26,
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text3)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
              lineHeight: 1,
            }}
          >
            ×
          </button>

          <Sidebar
            currentView={activeView}
            onNavigate={handleNavigate}
            onRaiseInvoice={() => {}}
          />
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          background: 'var(--bg)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}>
          {/* View label strip */}
          <div style={{
            padding: '10px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              🔍 Quick View
            </span>
            {overlayProject && (
              <>
                <span style={{ color: 'var(--text3)', fontSize: 11 }}>›</span>
                <span style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {overlayProject.address || overlayProject.ref || 'Project'}
                </span>
                <button
                  onClick={() => { setOverlayProject(null); setOverlayView('projects'); }}
                  style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 11.5, cursor: 'pointer', padding: 0, fontWeight: 500 }}
                >
                  ← Back
                </button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: 'var(--text3)', fontStyle: 'italic' }}>
              Close this view to return to where you were
            </span>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {renderContent()}
          </div>
        </div>
      </div>
    </>
  );
}
