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

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  projects: 'Projects',
  contacts: 'Contacts',
  calendar: 'Calendar',
  inbox: 'Inbox',
  settings: 'Settings',
  accounting: 'Accounting',
  notices: 'Notices',
  awards: 'Awards',
};

export default function QuickRefOverlay({ onClose }) {
  const [overlayView, setOverlayView] = useState('dashboard');
  const [overlayProject, setOverlayProject] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { state } = useApp();

  const handleNavigate = (view) => {
    if (EXCLUDED.has(view)) return;
    setOverlayProject(null);
    setOverlayView(view);
    setSidebarOpen(false);
  };

  const handleOpenProject = (project) => {
    if (!project) return;
    setOverlayProject(project);
    setOverlayView('project');
    setSidebarOpen(false);
  };

  const renderContent = () => {
    switch (overlayView) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} onOpenProject={handleOpenProject} />;
      case 'projects':
        return <ProjectList onOpenProject={handleOpenProject} />;
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
  const viewTitle = overlayProject
    ? (overlayProject.address || overlayProject.ref || 'Project')
    : (VIEW_TITLES[overlayView] || overlayView);

  return (
    <>
      <style>{`
        @keyframes qrSlideIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes qrSlideUp {
          from { opacity: 0; transform: translateY(100%); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .qr-desktop-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: min(82vw, 1200px);
          height: 85vh;
          z-index: 8001;
          display: flex;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 32px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07);
          animation: qrSlideIn 0.2s ease;
        }
        .qr-mobile-panel {
          position: fixed;
          top: 54px;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 8001;
          display: flex;
          flex-direction: column;
          background: var(--bg);
          animation: qrSlideUp 0.25s ease;
          overflow: hidden;
        }
        .qr-mobile-topbar {
          background: var(--bg2);
          border-bottom: 1px solid var(--border);
          padding: 11px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .qr-mobile-topbar-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .qr-burger {
          background: none;
          border: none;
          color: var(--text2);
          cursor: pointer;
          padding: 5px;
          font-size: 18px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .qr-mobile-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .qr-close-btn {
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          cursor: pointer;
          color: var(--text2);
          flex-shrink: 0;
        }
        .qr-mobile-content {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          -webkit-overflow-scrolling: touch;
        }
        .qr-mobile-drawer-backdrop {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 8010;
        }
        .qr-mobile-drawer-backdrop.open { display: block; }
        .qr-mobile-drawer {
          position: fixed;
          left: 0; top: 0; bottom: 0;
          width: 260px;
          background: var(--bg2);
          z-index: 8011;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
          overflow-y: auto;
        }
        .qr-mobile-drawer.open { transform: translateX(0); }
        .qr-back-btn {
          background: none;
          border: none;
          color: var(--blue);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          padding: 0;
          flex-shrink: 0;
        }
        @media (max-width: 768px) {
          .qr-desktop-panel { display: none !important; }
          .qr-desktop-backdrop { display: none !important; }
        }
        @media (min-width: 769px) {
          .qr-mobile-panel { display: none !important; }
        }
      `}</style>

      {/* ── DESKTOP: existing split-panel ── */}
      <div
        className="qr-desktop-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,0.45)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 8000,
        }}
      />
      <div className="qr-desktop-panel">
        {/* Sidebar */}
        <div style={{
          width: 210, minWidth: 210,
          background: 'var(--bg2)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto', position: 'relative',
        }}>
          <button
            onClick={onClose}
            title="Close quick view"
            style={{
              position: 'absolute', top: 10, right: 10,
              width: 26, height: 26, borderRadius: '50%',
              border: '1px solid var(--border)', background: 'var(--bg3)',
              color: 'var(--text3)', fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1, lineHeight: 1,
            }}
          >×</button>
          <Sidebar currentView={activeView} onNavigate={handleNavigate} onRaiseInvoice={() => {}} />
        </div>

        {/* Content */}
        <div style={{
          flex: 1, background: 'var(--bg)', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', minWidth: 0,
        }}>
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg2)', display: 'flex', alignItems: 'center',
            gap: 10, flexShrink: 0,
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
                >← Back</button>
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

      {/* ── MOBILE: full-screen overlay ── */}
      <div className="qr-mobile-panel">

        {/* Mobile topbar */}
        <div className="qr-mobile-topbar">
          <div className="qr-mobile-topbar-left">
            <button className="qr-burger" onClick={() => setSidebarOpen(true)}>☰</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {overlayProject && (
                <button
                  className="qr-back-btn"
                  onClick={() => { setOverlayProject(null); setOverlayView('projects'); }}
                >← </button>
              )}
              <span className="qr-mobile-title">{viewTitle}</span>
            </div>
          </div>
          <button className="qr-close-btn" onClick={onClose}>×</button>
        </div>

        {/* Mobile content */}
        <div className="qr-mobile-content">
          {renderContent()}
        </div>

        {/* Drawer backdrop */}
        <div
          className={`qr-mobile-drawer-backdrop${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* Drawer sidebar */}
        <div className={`qr-mobile-drawer${sidebarOpen ? ' open' : ''}`}>
          <Sidebar
            currentView={activeView}
            onNavigate={handleNavigate}
            onRaiseInvoice={() => {}}
          />
        </div>
      </div>
    </>
  );
}
