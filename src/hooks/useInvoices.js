import { useState, useEffect, useCallback } from 'react';
import sb from '../supabaseClient';

export function useInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await sb
        .from('invoices')
        .select('*')
        .order('invoice_number', { ascending: false });
      if (error) throw error;
      setInvoices(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const createInvoice = async (invoiceData) => {
    const { data, error } = await sb
      .from('invoices')
      .insert([invoiceData])
      .select()
      .single();
    if (error) throw error;
    setInvoices(prev => [data, ...prev]);
    return data;
  };

  const updateInvoice = async (id, updates) => {
    const { data, error } = await sb
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setInvoices(prev => prev.map(inv => inv.id === id ? data : inv));
    return data;
  };

  const markPaid = async (id, paidDate = new Date().toISOString().split('T')[0]) => {
    return updateInvoice(id, { status: 'paid', paid_date: paidDate });
  };

  const deleteInvoice = async (id) => {
    const { error } = await sb.from('invoices').delete().eq('id', id);
    if (error) throw error;
    setInvoices(prev => prev.filter(inv => inv.id !== id));
  };

  // Dashboard summary stats
  const getStats = () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonthInvoices = invoices.filter(inv =>
      new Date(inv.invoice_date) >= monthStart
    );
    const thisMonthPaid = invoices.filter(inv =>
      inv.status === 'paid' && inv.paid_date && new Date(inv.paid_date) >= monthStart
    );
    const outstanding = invoices.filter(inv => inv.status === 'unpaid');
    const overdue = invoices.filter(inv => {
      if (inv.status !== 'unpaid') return false;
      if (!inv.due_date) return false;
      return new Date(inv.due_date) < now;
    });

    return {
      invoicedThisMonth: thisMonthInvoices.reduce((s, i) => s + (i.total || 0), 0),
      paidThisMonth: thisMonthPaid.reduce((s, i) => s + (i.total || 0), 0),
      outstanding: outstanding.reduce((s, i) => s + (i.total || 0), 0),
      outstandingCount: outstanding.length,
      overdue: overdue.reduce((s, i) => s + (i.total || 0), 0),
      overdueCount: overdue.length,
    };
  };

  return {
    invoices,
    loading,
    error,
    fetchInvoices,
    createInvoice,
    updateInvoice,
    markPaid,
    deleteInvoice,
    getStats,
  };
}
