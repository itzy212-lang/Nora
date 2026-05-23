// api/generate-invoice-pdf.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API2PDF_KEY = process.env.API2PDF_API_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function money(value) {
  return `£${Number(value || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeFileName(value) {
  return String(value || 'Invoice')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function spaced(text) {
  return esc(String(text || '').toUpperCase().split('').join(' '));
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
}

function statusLabel(value) {
  const raw = String(value || '').toLowerCase();

  if (raw === 'paid') return 'Paid';
  if (raw === 'void') return 'Void';
  if (raw === 'overdue') return 'Overdue';
  if (raw === 'draft') return 'Draft';

  return 'Awaiting Payment';
}

function getInvoiceNumber(invoice) {
  const raw = invoice.invoice_number || invoice.id || '';
  if (!raw) return '';

  return String(raw).startsWith('INV-')
    ? String(raw)
    : `INV-${raw}`;
}

function mergeSettings(invoice, firm = {}, invoiceSettings = {}) {
  return {
    firmName:
      invoice.firm_name ||
      firm.firm_name ||
      firm.trading_name ||
      'Square One Consulting',

    firmAddress:
      invoice.firm_address ||
      [
        firm.address_line1,
        firm.address_line2,
        firm.city,
        firm.postcode,
      ].filter(Boolean).join(', ') ||
      'Suite 28, 708a High Road, London, N12 9QL',

    firmPhone:
      invoice.firm_phone ||
      firm.tel ||
      firm.phone ||
      '07889996841',

    firmEmail:
      invoice.firm_email ||
      firm.email ||
      'help@sq1consulting.co.uk',

    bankName:
      invoice.bank_name ||
      invoice.account_name ||
      invoiceSettings.account_name ||
      invoiceSettings.bank_name ||
      firm.bank_name ||
      'Itzik Ltd',

    sortCode:
      invoice.sort_code ||
      invoiceSettings.sort_code ||
      firm.sort_code ||
      '04-03-33',

    accountNo:
      invoice.account_number ||
      invoice.account_no ||
      invoiceSettings.account_number ||
      firm.account_number ||
      '67644868',

    notes:
      invoice.invoice_notes ||
      invoiceSettings.invoice_notes ||
      firm.footer_text ||
      'Thank you for your business.',
  };
}

function buildInvoiceHtml(invoice, firm, invoiceSettings) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const invNo = getInvoiceNumber(invoice);
  const projectRef = invoice.project_ref || invoice.ref || invoice.project_reference || '';
  const settings = mergeSettings(invoice, firm, invoiceSettings);

  const subtotal = Number(invoice.subtotal || 0);
  const vatAmt = Number(invoice.vat_amount || 0);
  const totalDue = Number(invoice.total || subtotal + vatAmt);

  const rows = items.map(item => {
    const qty = Number(item.qty || 0);
    const unit = Number(item.unitPrice ?? item.unit_price ?? 0);
    const total = Number(item.total ?? qty * unit);

    return `
      <tr>
        <td class="td-desc">${esc(item.description || '')}</td>
        <td class="td-r qty">${qty || ''}</td>
        <td class="td-r unit">${money(unit)}</td>
        <td class="td-r total">${money(total)}</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(invNo || 'Invoice')}</title>
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #111827;
    background: #fff;
    font-size: 12.5px;
    line-height: 1.45;
    padding: 46px 54px;
  }

  .top {
    display: grid;
    grid-template-columns: 1fr 230px;
    gap: 32px;
    align-items: start;
    margin-bottom: 42px;
  }

  .firm-name {
    font-size: 19px;
    font-weight: 700;
    margin-bottom: 9px;
    color: #111827;
  }

  .firm-line {
    font-size: 12.5px;
    color: #374151;
    line-height: 1.55;
  }

  .invoice-title {
    text-align: right;
  }

  .invoice-word {
    font-size: 29px;
    letter-spacing: 1.5px;
    line-height: 1;
    font-weight: 500;
    color: #111827;
    margin-bottom: 13px;
  }

  .invoice-no {
    font-size: 13px;
    color: #111827;
    font-weight: 500;
  }

  .meta {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    column-gap: 24px;
    margin-bottom: 36px;
  }

  .label {
    font-size: 10px;
    color: #111827;
    font-weight: 700;
    letter-spacing: 3.1px;
    line-height: 1.2;
    margin-bottom: 9px;
    white-space: nowrap;
  }

  .value {
    font-size: 12.5px;
    color: #111827;
    line-height: 1.45;
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 58px;
    margin-bottom: 32px;
  }

  .block-value {
    min-height: 42px;
    color: #111827;
    line-height: 1.55;
    font-size: 12.5px;
  }

  .service-line {
    margin-top: 24px;
    margin-bottom: 23px;
    color: #111827;
    font-size: 12.5px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 18px;
  }

  th {
    text-align: left;
    font-size: 10px;
    color: #111827;
    font-weight: 700;
    letter-spacing: 3.1px;
    padding: 0 0 11px 0;
    border: none;
    white-space: nowrap;
  }

  th.th-r {
    text-align: right;
  }

  td {
    vertical-align: top;
    padding: 0 0 14px 0;
    font-size: 12.5px;
    color: #111827;
    line-height: 1.5;
    border: none;
  }

  .td-desc {
    width: 66%;
    padding-right: 22px;
  }

  .td-r {
    text-align: right;
    white-space: nowrap;
  }

  .qty {
    width: 8%;
  }

  .unit {
    width: 13%;
  }

  .total {
    width: 13%;
  }

  .totals {
    width: 230px;
    margin-left: auto;
    margin-top: 2px;
    margin-bottom: 44px;
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    gap: 22px;
    font-size: 12.5px;
    line-height: 1.6;
    margin-bottom: 6px;
  }

  .total-row.final {
    font-weight: 700;
    margin-top: 4px;
  }

  .footer-grid {
    display: grid;
    grid-template-columns: 118px 118px 138px 1fr;
    column-gap: 26px;
    align-items: start;
    margin-top: 8px;
  }

  .footer-value {
    font-size: 12.5px;
    line-height: 1.45;
    color: #111827;
    margin-top: 7px;
  }

  .thanks {
    align-self: end;
    font-size: 12.5px;
    color: #111827;
    line-height: 1.45;
    padding-top: 25px;
  }

  .notes {
    margin-top: 18px;
    padding: 12px 14px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 11px;
    color: #374151;
    white-space: pre-wrap;
  }
</style>
</head>

<body>
  <div class="top">
    <div>
      <div class="firm-name">${esc(settings.firmName)}</div>
      ${settings.firmAddress ? `<div class="firm-line">${esc(settings.firmAddress)}</div>` : ''}
      ${settings.firmPhone ? `<div class="firm-line">${esc(settings.firmPhone)}</div>` : ''}
      ${settings.firmEmail ? `<div class="firm-line">${esc(settings.firmEmail)}</div>` : ''}
    </div>

    <div class="invoice-title">
      <div class="invoice-word">INVOICE</div>
      <div class="invoice-no">${esc(invNo)}</div>
    </div>
  </div>

  <div class="meta">
    <div>
      <div class="label">${spaced('Issue Date')}</div>
      <div class="value">${esc(formatDate(invoice.invoice_date))}</div>
    </div>

    <div>
      <div class="label">${spaced('Due Date')}</div>
      <div class="value">${esc(formatDate(invoice.due_date))}</div>
    </div>

    <div>
      <div class="label">${spaced('Project Ref')}</div>
      <div class="value">${esc(projectRef)}</div>
    </div>

    <div>
      <div class="label">${spaced('Status')}</div>
      <div class="value">${esc(statusLabel(invoice.status))}</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="label">${spaced('Bill To')}</div>
      <div class="block-value">
        <strong>${esc(invoice.bill_to_name || '')}</strong><br />
        ${esc(invoice.bill_to_address || '').replace(/\n/g, '<br />')}
      </div>
    </div>

    <div>
      <div class="label">${spaced('In Respect Of')}</div>
      <div class="block-value">
        ${esc(invoice.property_address || '').replace(/\n/g, '<br />')}
      </div>
    </div>
  </div>

  <div class="service-line">Party wall surveyor services</div>

  <table>
    <thead>
      <tr>
        <th>${spaced('Description')}</th>
        <th class="th-r">${spaced('Qty')}</th>
        <th class="th-r">${spaced('Unit')}</th>
        <th class="th-r">${spaced('Total')}</th>
      </tr>
    </thead>

    <tbody>
      ${rows || '<tr><td class="td-desc" colspan="4">No line items</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row">
      <span>Subtotal</span>
      <span>${money(subtotal)}</span>
    </div>

    ${vatAmt > 0 ? `
    <div class="total-row">
      <span>VAT</span>
      <span>${money(vatAmt)}</span>
    </div>
    ` : ''}

    <div class="total-row final">
      <span>Total Due</span>
      <span>${money(totalDue)}</span>
    </div>
  </div>

  <div class="footer-grid">
    <div>
      <div class="label">${spaced('Bank')}</div>
      <div class="footer-value">${esc(settings.bankName)}</div>
    </div>

    <div>
      <div class="label">${spaced('Sort Code')}</div>
      <div class="footer-value">${esc(settings.sortCode)}</div>
    </div>

    <div>
      <div class="label">${spaced('Account No.')}</div>
      <div class="footer-value">${esc(settings.accountNo)}</div>
    </div>

    <div class="thanks">${esc(settings.notes)}</div>
  </div>

  ${invoice.notes && invoice.notes !== settings.notes ? `
  <div class="notes">
    <strong>Notes:</strong><br />
    ${esc(invoice.notes)}
  </div>
  ` : ''}
</body>
</html>`;
}

async function loadFirmSettings(sb) {
  try {
    const { data } = await sb
      .from('firm_settings')
      .select('firm_name,trading_name,address_line1,address_line2,city,postcode,tel,phone,email,footer_text,bank_name,sort_code,account_number')
      .limit(1);

    return data?.[0] || {};
  } catch {
    return {};
  }
}

async function loadInvoiceSettings(sb) {
  try {
    const { data } = await sb
      .from('ely_data')
      .select('data')
      .eq('data_type', 'invoice_settings')
      .limit(1);

    return data?.[0]?.data || {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  if (!API2PDF_KEY) {
    return res.status(500).json({ error: 'API2PDF_API_KEY not configured' });
  }

  const { invoice, project_id, invoice_id } = req.body || {};

  if (!invoice) {
    return res.status(400).json({ error: 'No invoice provided' });
  }

  const sb = getSupabase();
  const projectId = project_id || invoice.project_id || null;
  const invoiceId = invoice_id || invoice.id || null;
  const invoiceNumber = invoice.invoice_number || invoice.id || Date.now();
  const fileName = safeFileName(`Invoice-${invoiceNumber}.pdf`);
  const storagePath = `${projectId || 'unlinked'}/invoices/${Date.now()}_${fileName}`;

  try {
    const [firm, invoiceSettings] = await Promise.all([
      loadFirmSettings(sb),
      loadInvoiceSettings(sb),
    ]);

    const html = buildInvoiceHtml(invoice, firm, invoiceSettings);

    const pdfRes = await fetch('https://v2.api2pdf.com/chrome/pdf/html', {
      method: 'POST',
      headers: {
        Authorization: API2PDF_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html,
        fileName,
        options: {
          printBackground: true,
          marginTop: '0.35in',
          marginRight: '0.45in',
          marginBottom: '0.35in',
          marginLeft: '0.45in',
          format: 'A4',
        },
      }),
    });

    const pdfData = await pdfRes.json();

    if (!pdfRes.ok || !pdfData?.FileUrl) {
      return res.status(500).json({
        error: pdfData?.Message || pdfData?.error || 'PDF generation failed',
      });
    }

    const fileRes = await fetch(pdfData.FileUrl);
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    const { error: uploadError } = await sb.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    let docId = null;

    if (projectId) {
      const { data: doc, error: docError } = await sb
        .from('documents')
        .insert([{
          project_id: projectId,
          file_name: fileName,
          file_type: 'pdf',
          category: 'invoice',
          section_type: 'invoice',
          storage_path: storagePath,
          status: 'generated',
          version: 1,
          created_at: new Date().toISOString(),
          metadata: {
            invoice_id: invoiceId,
            invoice_number: invoiceNumber,
            total: invoice.total || 0,
          },
        }])
        .select('id')
        .single();

      if (!docError) docId = doc?.id || null;
    }

    return res.status(200).json({
      success: true,
      file_name: fileName,
      storage_path: storagePath,
      document_id: docId,
      base64: `data:application/pdf;base64,${base64}`,
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Could not generate invoice PDF',
    });
  }
}
