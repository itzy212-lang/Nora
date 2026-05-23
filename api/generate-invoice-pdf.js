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

function escapeHtml(value) {
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

function label(text) {
  return escapeHtml(String(text || '').toUpperCase().split('').join(' '));
}

function statusLabel(status) {
  const raw = String(status || '').toLowerCase();
  if (raw === 'paid') return 'Paid';
  if (raw === 'void') return 'Void';
  if (raw === 'overdue') return 'Overdue';
  return 'Awaiting Payment';
}

function buildInvoiceHtml(invoice) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const invoiceLabel = String(invoiceNumber).startsWith('INV-')
    ? invoiceNumber
    : `INV-${invoiceNumber}`;

  const projectRef =
    invoice.project_ref ||
    invoice.ref ||
    invoice.project_reference ||
    '';

  const firmName =
    invoice.firm_name ||
    'Square One Consulting';

  const firmAddress =
    invoice.firm_address ||
    'Suite 28, 708a High Road, London, N12 9QL';

  const firmPhone =
    invoice.firm_phone ||
    '07889996841';

  const firmEmail =
    invoice.firm_email ||
    'help@sq1consulting.co.uk';

  const bankName =
    invoice.bank_name ||
    invoice.account_name ||
    'Itzik Ltd';

  const sortCode =
    invoice.sort_code ||
    '04-03-33';

  const accountNo =
    invoice.account_number ||
    invoice.account_no ||
    '67644868';

  const notes =
    invoice.notes ||
    invoice.invoice_notes ||
    'Thank you for your business.';

  const rows = items.map(item => {
    const qty = Number(item.qty || 0);

    const unit = Number(
      item.unitPrice ??
      item.unit_price ??
      0
    );

    const total = Number(
      item.total ??
      qty * unit
    );

    return `
      <tr>
        <td class="description">
          ${escapeHtml(item.description || '')}
        </td>

        <td class="num qty">
          ${qty || ''}
        </td>

        <td class="num unit">
          ${money(unit)}
        </td>

        <td class="num total">
          ${money(total)}
        </td>
      </tr>
    `;
  }).join('');

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />

<title>
${escapeHtml(invoiceLabel)}
</title>

<style>
* {
  box-sizing: border-box;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  color: #111827;
  margin: 0;
  padding: 46px 54px;
  font-size: 12.5px;
  line-height: 1.45;
  background: #ffffff;
}

.page {
  width: 100%;
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

.firm-lines {
  color: #374151;
  line-height: 1.55;
  font-size: 12.5px;
}

.invoice-title {
  text-align: right;
  padding-top: 1px;
}

.invoice-title-main {
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

.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  column-gap: 24px;
  margin-bottom: 36px;
}

.spaced-label {
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
  margin-top: 0;
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

th.num {
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

td.description {
  width: 66%;
  padding-right: 22px;
}

td.num {
  text-align: right;
  white-space: nowrap;
}

td.qty {
  width: 8%;
}

td.unit {
  width: 13%;
}

td.total {
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
  grid-template-columns:
    118px
    118px
    138px
    1fr;
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
</style>
</head>

<body>

<div class="page">

  <div class="top">

    <div>
      <div class="firm-name">
        ${escapeHtml(firmName)}
      </div>

      <div class="firm-lines">
        ${escapeHtml(firmAddress)}<br />
        ${escapeHtml(firmPhone)}<br />
        ${escapeHtml(firmEmail)}
      </div>
    </div>

    <div class="invoice-title">
      <div class="invoice-title-main">
        INVOICE
      </div>

      <div class="invoice-no">
        ${escapeHtml(invoiceLabel)}
      </div>
    </div>

  </div>

  <div class="meta-grid">

    <div>
      <div class="spaced-label">
        ${label('Issue Date')}
      </div>

      <div class="value">
        ${escapeHtml(formatDate(invoice.invoice_date))}
      </div>
    </div>

    <div>
      <div class="spaced-label">
        ${label('Due Date')}
      </div>

      <div class="value">
        ${escapeHtml(formatDate(invoice.due_date))}
      </div>
    </div>

    <div>
      <div class="spaced-label">
        ${label('Project Ref')}
      </div>

      <div class="value">
        ${escapeHtml(projectRef)}
      </div>
    </div>

    <div>
      <div class="spaced-label">
        ${label('Status')}
      </div>

      <div class="value">
        ${escapeHtml(statusLabel(invoice.status))}
      </div>
    </div>

  </div>

  <div class="two-col">

    <div>
      <div class="spaced-label">
        ${label('Bill To')}
      </div>

      <div class="block-value">
        ${escapeHtml(invoice.bill_to_name || '')}<br />
        ${escapeHtml(invoice.bill_to_address || '').replace(/\n/g, '<br />')}
      </div>
    </div>

    <div>
      <div class="spaced-label">
        ${label('In Respect Of')}
      </div>

      <div class="block-value">
        ${escapeHtml(invoice.property_address || '').replace(/\n/g, '<br />')}
      </div>
    </div>

  </div>

  <div class="service-line">
    Party wall surveyor services
  </div>

  <table>

    <thead>
      <tr>
        <th>${label('Description')}</th>
        <th class="num">${label('Qty')}</th>
        <th class="num">${label('Unit')}</th>
        <th class="num">${label('Total')}</th>
      </tr>
    </thead>

    <tbody>
      ${rows}
    </tbody>

  </table>

  <div class="totals">

    <div class="total-row">
      <span>Subtotal</span>
      <span>${money(invoice.subtotal)}</span>
    </div>

    ${Number(invoice.vat_amount || 0) > 0 ? `
    <div class="total-row">
      <span>VAT</span>
      <span>${money(invoice.vat_amount)}</span>
    </div>
    ` : ''}

    <div class="total-row final">
      <span>Total Due</span>
      <span>${money(invoice.total)}</span>
    </div>

  </div>

  <div class="footer-grid">

    <div>
      <div class="spaced-label">
        ${label('Bank')}
      </div>

      <div class="footer-value">
        ${escapeHtml(bankName)}
      </div>
    </div>

    <div>
      <div class="spaced-label">
        ${label('Sort Code')}
      </div>

      <div class="footer-value">
        ${escapeHtml(sortCode)}
      </div>
    </div>

    <div>
      <div class="spaced-label">
        ${label('Account No.')}
      </div>

      <div class="footer-value">
        ${escapeHtml(accountNo)}
      </div>
    </div>

    <div class="thanks">
      ${escapeHtml(notes)}
    </div>

  </div>

</div>

</body>
</html>
`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({
      error: 'Supabase environment variables not configured',
    });
  }

  if (!API2PDF_KEY) {
    return res.status(500).json({
      error: 'API2PDF_API_KEY not configured',
    });
  }

  const {
    invoice,
    project_id,
    invoice_id,
  } = req.body || {};

  if (!invoice) {
    return res.status(400).json({
      error: 'No invoice provided',
    });
  }

  const projectId =
    project_id ||
    invoice.project_id ||
    null;

  const invoiceId =
    invoice_id ||
    invoice.id ||
    null;

  const invoiceNumber =
    invoice.invoice_number ||
    invoice.id ||
    Date.now();

  const fileName = safeFileName(
    `Invoice-${invoiceNumber}.pdf`
  );

  const storagePath =
    `${projectId || 'unlinked'}/invoices/${Date.now()}_${fileName}`;

  try {
    const html = buildInvoiceHtml(invoice);

    const pdfRes = await fetch(
      'https://v2.api2pdf.com/chrome/pdf/html',
      {
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
            marginTop: '0.25in',
            marginRight: '0.25in',
            marginBottom: '0.25in',
            marginLeft: '0.25in',
          },
        }),
      }
    );

    const pdfData = await pdfRes.json();

    if (!pdfRes.ok || !pdfData?.FileUrl) {
      return res.status(500).json({
        error:
          pdfData?.Message ||
          pdfData?.error ||
          'PDF generation failed',
      });
    }

    const fileRes = await fetch(
      pdfData.FileUrl
    );

    const arrayBuffer =
      await fileRes.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    const base64 =
      buffer.toString('base64');

    const sb = getSupabase();

    const { error: uploadError } =
      await sb.storage
        .from('documents')
        .upload(storagePath, buffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

    if (uploadError) {
      throw uploadError;
    }

    let docId = null;

    if (projectId) {
      const {
        data: doc,
        error: docError,
      } = await sb
        .from('documents')
        .insert([
          {
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
          },
        ])
        .select('id')
        .single();

      if (!docError) {
        docId = doc?.id || null;
      }
    }

    return res.status(200).json({
      success: true,
      file_name: fileName,
      storage_path: storagePath,
      document_id: docId,
      base64:
        `data:application/pdf;base64,${base64}`,
    });

  } catch (err) {
    return res.status(500).json({
      error:
        err?.message ||
        'Could not generate invoice PDF',
    });
  }
}
