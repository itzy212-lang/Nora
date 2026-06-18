import React, { useState, useEffect } from 'react';
import { useInvoices } from '../../hooks/useInvoices';
import InvoiceModal from './InvoiceModal';

const fmt = (n) => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

export default function Accounting({ projects = [], settings = {} }) {
  const isMobile = window.innerWidth < 768;
  const { invoices, loading, createInvoice, updateInvoice, markPaid, deleteInvoice, getStats } = useInvoices();
  const [tab, setTab] = useState('dashboard');
  const [showModal, setShowModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const stats = getStats();

  const nextInvoiceNumber = settings?.next_invoice_number
    || (invoices.length > 0
      ? Math.max(...invoices.map(i => parseInt(i.invoice_number) || 0)) + 1
      : 1601);

  const handleSave = async (data) => {
    if (editingInvoice) {
      await updateInvoice(editingInvoice.id, data);
    } else {
      await createInvoice(data);
    }
    setEditingInvoice(null);
  };

  const openEdit = (inv) => {
    setEditingInvoice(inv);
    setShowModal(true);
  };

  const handleDownload = async (inv) => {
    try {
      const res = await fetch('/api/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice: inv,
          invoice_id: inv.id,
          project_id: inv.project_id,
          user_id: 'help@sq1consulting.co.uk',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.base64) {
        alert(data.error || 'Could not generate PDF.');
        return;
      }
      // Trigger browser download — API returns data URI
      const a = document.createElement('a');
      a.href = data.base64;
      a.download = data.file_name || `Invoice-${inv.invoice_number}.pdf`;
      a.click();
    } catch (e) {
      alert('Download failed: ' + e.message);
    }
  };

  const handleMarkPaid = async (inv) => {
    await markPaid(inv.id);
  };

  const handleDelete = async (id) => {
    await deleteInvoice(id);
    setConfirmDelete(null);
  };

  const unpaidInvoices = invoices.filter(i => i.status === 'unpaid');
  const paidInvoices = invoices.filter(i => i.status === 'paid');

  // Group by property address for "by project" panel
  const byProject = invoices.reduce((acc, inv) => {
    const key = inv.property_address || 'Unknown';
    if (!acc[key]) acc[key] = { address: key, total: 0, paid: 0, invoiceNum: inv.invoice_number };
    acc[key].total += inv.total || 0;
    if (inv.status === 'paid') acc[key].paid += inv.total || 0;
    return acc;
  }, {});

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Accounting</h1>
        <button onClick={() => { setEditingInvoice(null); setShowModal(true); }} style={styles.primaryBtn}>
          + Invoice
        </button>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {['dashboard', 'invoices', 'receipts', 'expenses'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* DASHBOARD TAB */}
      {tab === 'dashboard' && (
        <div style={styles.tabContent}>
          {/* Stats grid */}
          <div style={styles.statsGrid}>
            <StatCard label="Invoiced This Month" value={fmt(stats.invoicedThisMonth)} color="#3d5a99" />
            <StatCard label="Paid This Month" value={fmt(stats.paidThisMonth)} color="#2e8b57" />
            <StatCard label="Outstanding" value={fmt(stats.outstanding)} color="#e8a020"
              sub={stats.outstandingCount > 0 ? `${stats.outstandingCount} unpaid invoice${stats.outstandingCount > 1 ? 's' : ''}` : null} />
            <StatCard label="Overdue" value={fmt(stats.overdue)} color="#cc4444"
              sub={stats.overdueCount > 0 ? `${stats.overdueCount} overdue` : null} />
            <StatCard label="Expenses This Month" value="£0.00" color="#888" />
            <StatCard label="Net Profit This Month" value={fmt(stats.paidThisMonth)} color="#2e8b57" />
          </div>

          {/* Lower panels */}
          <div style={styles.panelRow}>
            {/* Recent transactions */}
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Recent transactions</div>
              {invoices.length === 0 ? (
                <p style={styles.empty}>No transactions yet.</p>
              ) : (
                <div>
                  {invoices.slice(0, 8).map(inv => (
                    <div key={inv.id} style={styles.txRow}>
                      <div>
                        <div style={styles.txRef}>Invoice-{inv.invoice_number}</div>
                        <div style={styles.txAddr}>{inv.property_address}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={styles.txAmount}>{fmt(inv.total)}</div>
                        <StatusBadge status={inv.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* By project */}
            <div style={{ ...styles.panel, flex: '0 0 320px' }}>
              <div style={styles.panelTitle}>By project</div>
              {Object.values(byProject).length === 0 ? (
                <p style={styles.empty}>No data yet.</p>
              ) : (
                Object.values(byProject).map((p, i) => (
                  <div key={i} style={styles.projectRow}>
                    <div>
                      <div style={styles.txRef}>Invoice-{p.invoiceNum}</div>
                      <div style={styles.txAddr}>{p.address}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={styles.txAmount}>{fmt(p.total)}</div>
                      <div style={{ fontSize: 11, color: p.paid >= p.total ? '#2e8b57' : '#e8a020' }}>
                        {p.paid >= p.total ? 'Paid' : `£${(p.total - p.paid).toFixed(2)} unpaid`}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* INVOICES TAB */}
      {tab === 'invoices' && (
        <div style={styles.tabContent}>
          {/* Unpaid section */}
          {unpaidInvoices.length > 0 && (
            <div style={styles.invoiceSection}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionLabel}>Unpaid Invoices</span>
                <span style={styles.sectionTotal}>{fmt(stats.outstanding)}</span>
              </div>
              <InvoiceTable
                invoices={unpaidInvoices}
                onEdit={openEdit}
                onMarkPaid={handleMarkPaid}
                onDelete={(id) => setConfirmDelete(id)}
                onDownload={handleDownload}
              />
            </div>
          )}

          {/* Paid section */}
          {paidInvoices.length > 0 && (
            <div style={styles.invoiceSection}>
              <div style={styles.sectionHeader}>
                <span style={{ ...styles.sectionLabel, color: '#2e8b57' }}>Paid Invoices</span>
                <span style={{ ...styles.sectionTotal, color: '#2e8b57' }}>
                  {fmt(paidInvoices.reduce((s, i) => s + (i.total || 0), 0))}
                </span>
              </div>
              <InvoiceTable
                invoices={paidInvoices}
                onEdit={openEdit}
                onDelete={(id) => setConfirmDelete(id)}
                onDownload={handleDownload}
                isPaid
              />
            </div>
          )}

          {invoices.length === 0 && !loading && (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>💰</div>
              <p>No invoices yet. Click <strong>+ Invoice</strong> to raise your first one.</p>
            </div>
          )}
          {loading && <p style={styles.empty}>Loading invoices...</p>}
        </div>
      )}

      {/* RECEIPTS TAB */}
      {tab === 'receipts' && (
        <div style={styles.tabContent}>
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>🧾</div>
            <p>Receipt capture coming soon.</p>
          </div>
        </div>
      )}

      {/* EXPENSES TAB */}
      {tab === 'expenses' && (
        <div style={styles.tabContent}>
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📊</div>
            <p>Expenses tracking coming soon.</p>
          </div>
        </div>
      )}

      {/* Invoice Modal */}
      {showModal && (
        <InvoiceModal
          invoice={editingInvoice}
          nextNumber={nextInvoiceNumber}
          settings={settings}
          projects={projects}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingInvoice(null); }}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={styles.overlay}>
          <div style={styles.confirmModal}>
            <p style={{ margin: '0 0 16px', fontWeight: 600 }}>Delete this invoice?</p>
            <p style={{ margin: '0 0 20px', color: '#666', fontSize: 14 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={styles.cancelBtn}>Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} style={styles.deleteBtn}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-components
function StatCard({ label, value, color, sub }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const isPaid = status === 'paid';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: isPaid ? '#e6f4ec' : '#fff4e0',
      color: isPaid ? '#2e8b57' : '#e8a020',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {isPaid ? 'Paid' : 'Unpaid'}
    </span>
  );
}

function InvoiceTable({ invoices, onEdit, onMarkPaid, onDelete, onDownload, isPaid }) {
  return (
    <div>
      {invoices.map(inv => (
        <div key={inv.id} style={styles.invoiceCard}>
          <div style={styles.invoiceCardTop}>
            <span style={styles.invoiceCardRef}>Invoice-{inv.invoice_number}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>{fmt(inv.total)}</span>
          </div>
          <div style={styles.invoiceCardAddr}>{inv.property_address}</div>
          {inv.bill_to_name && <div style={styles.invoiceCardClient}>{inv.bill_to_name}</div>}
          <div style={styles.invoiceCardBottom}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusBadge status={inv.status} />
              <span style={styles.invoiceCardDate}>{fmtDate(inv.invoice_date)}</span>
            </div>
            <div style={styles.actions}>
              <button onClick={() => onEdit(inv)} style={styles.actionBtn} title="Edit">✏️</button>
              {onDownload && (
                <button onClick={() => onDownload(inv)} style={styles.actionBtn} title="Download PDF">⬇️</button>
              )}
              {!isPaid && onMarkPaid && (
                <button onClick={() => onMarkPaid(inv)} style={styles.actionBtn} title="Mark paid">✅</button>
              )}
              <button onClick={() => onDelete(inv.id)} style={styles.actionBtn} title="Delete">🗑️</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  container: { padding: '0 16px 24px', maxWidth: 1200 },
  pageHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 12px' },
  pageTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: '#1a1a2e' },
  primaryBtn: {
    background: '#3d5a99', color: '#fff', border: 'none', borderRadius: 8,
    padding: '8px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  tabs: { display: 'flex', gap: 0, borderBottom: '2px solid #e8e8f0', marginBottom: 16, overflowX: 'auto' },
  tab: {
    background: 'none', border: 'none', padding: '10px 14px', fontSize: 13,
    cursor: 'pointer', color: '#666', fontWeight: 500, borderBottom: '2px solid transparent',
    marginBottom: -2, whiteSpace: 'nowrap', flexShrink: 0,
  },
  tabActive: { color: '#3d5a99', fontWeight: 700, borderBottomColor: '#3d5a99' },
  tabContent: { display: 'flex', flexDirection: 'column', gap: 16 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 },
  statCard: {
    background: '#fff', borderRadius: 12, padding: '14px 16px',
    border: '1px solid #e8e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  },
  statLabel: { fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 },
  statValue: { fontSize: 22, fontWeight: 700 },
  statSub: { fontSize: 11, color: '#888', marginTop: 3 },
  panelRow: { display: 'flex', flexDirection: 'column', gap: 12 },
  panel: {
    flex: 1, background: '#fff', borderRadius: 12, padding: '14px 16px',
    border: '1px solid #e8e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  },
  panelTitle: { fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 10 },
  empty: { color: '#aaa', fontSize: 13, margin: 0 },
  txRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '8px 0', borderBottom: '1px solid #f0f0f8',
  },
  projectRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '8px 0', borderBottom: '1px solid #f0f0f8',
  },
  txRef: { fontSize: 13, fontWeight: 600, color: '#1a1a2e' },
  txAddr: { fontSize: 11, color: '#999', marginTop: 2 },
  txAmount: { fontSize: 13, fontWeight: 700, color: '#1a1a2e' },
  invoiceSection: { background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #e8e8f0' },
  sectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #f0f0f8',
  },
  sectionLabel: { fontSize: 13, fontWeight: 700, color: '#e8a020' },
  sectionTotal: { fontSize: 15, fontWeight: 700, color: '#e8a020' },
  emptyState: { textAlign: 'center', padding: '40px 20px', color: '#aaa' },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  // Mobile invoice cards instead of table
  invoiceCard: {
    padding: '12px 0', borderBottom: '1px solid #f0f0f8',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  invoiceCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  invoiceCardRef: { fontSize: 13, fontWeight: 700, color: '#3d5a99' },
  invoiceCardAmount: { fontSize: 14, fontWeight: 700, color: '#1a1a2e' },
  invoiceCardAddr: { fontSize: 12, color: '#1a1a2e', fontWeight: 500 },
  invoiceCardClient: { fontSize: 11, color: '#999' },
  invoiceCardBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  invoiceCardDate: { fontSize: 11, color: '#999' },
  actions: { display: 'flex', gap: 6 },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 4px', borderRadius: 4 },
  // Keep table styles for desktop fallback
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid #f0f0f8', textAlign: 'left' },
  tr: { transition: 'background 0.15s' },
  td: { padding: '10px 10px', fontSize: 13, borderBottom: '1px solid #f8f8fc', color: '#333', verticalAlign: 'middle' },
  invRef: { fontWeight: 700, color: '#3d5a99' },
  addr: { color: '#1a1a2e', fontWeight: 500 },
  client: { fontSize: 11, color: '#999', marginTop: 2 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  confirmModal: { background: '#fff', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  cancelBtn: { padding: '8px 18px', borderRadius: 8, border: '1px solid #dde0ee', background: '#fff', cursor: 'pointer', fontSize: 14 },
  deleteBtn: { padding: '8px 18px', borderRadius: 8, border: 'none', background: '#cc4444', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
};
