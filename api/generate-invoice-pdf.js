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

function buildInvoiceHtml(invoice) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const title = `Invoice-${invoiceNumber}`;

  const rows = items.map(item => {
    const qty = Number(item.qty || 0);
    const unit = Number(item.unitPrice ?? item.unit_price ?? 0);
    const total = Number(item.total ?? qty * unit);

    return `
      <tr>
        <td>${escapeHtml(item.description || '')}</td>
        <td class="num">${escapeHtml(qty || '')}</td>
        <td class="num">${money(unit)}</td>
        <td class="num">${money(total)}</td>
      </tr>
    `;
  }).join('');

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>

<style>
body {
  font-family: Arial, Helvetica, sans-serif;
  color: #1f2937;
  margin: 0;
  padding: 42px;
  font-size: 13px;
  line-height: 1.45;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid #1f3f77;
  padding-bottom: 18px;
  margin-bottom: 28px;
}

.firm {
  font-size: 20px;
  font-weight: 700;
  color: #1f3f77;
}

.invoice-title {
  text-align: right;
  font-size: 26px;
  font-weight: 700;
  color: #111827;
}

.muted {
  color: #6b7280;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-bottom: 24px;
}

.box {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 14px 16px;
  background: #fafafa;
  min-height: 96px;
}

.label {
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: .5px;
  margin-bottom: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 22px;
}

th {
  background: #f3f4f6;
  color: #374151;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .4px;
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid #d1d5db;
}

td {
  padding: 10px;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: top;
}

.num {
  text-align: right;
  white-space: nowrap;
}

.totals {
  width: 300px;
  margin-left: auto;
  margin-top: 18px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.total-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e5e7eb;
}

.total-row:last-child {
  border-bottom: none;
  background: #1f3f77;
  color: white;
  font-weight: 700;
  font-size: 15px;
}

.notes {
  margin-top: 28px;
  color: #4b5563;
  white-space: pre-wrap;
}
</style>
</head>

<body>

<div class="top">
  <div>
    <div class="firm">Square One Consulting</div>
    <div class="muted">Party Wall Surveyors</div>
  </div>

  <div class="invoice-title">
    INVOICE
    <div class="muted" style="font-size:13px;font-weight:400;">
      ${escapeHtml(title)}
    </div>
  </div>
</div>

<div class="grid">
  <div class="box">
    <div class="label">Bill To</div>

    <strong>${escapeHtml(invoice.bill_to_name || '')}</strong><br/>

    ${escapeHtml(invoice.bill_to_address || '').replace(/\n/g, '<br/>')}
  </div>

  <div class="box">
    <div class="label">Invoice Details</div>

    <strong>Invoice No:</strong> ${escapeHtml(invoiceNumber)}<br/>
    <strong>Date:</strong> ${escapeHtml(invoice.invoice_date || '')}<br/>
    <strong>Due:</strong> ${escapeHtml(invoice.due_date || '')}
  </div>
</div>

<div class="box">
  <div class="label">In Respect Of</div>

  ${escapeHtml(invoice.property_address || '').replace(/\n/g, '<br/>')}
</div>

<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="num">Qty</th>
      <th class="num">Unit Price</th>
      <th class="num">Total</th>
    </tr>
  </thead>

  <tbody>
    ${rows || '<tr><td colspan="4">No line items</td></tr>'}
  </tbody>
</table>

<div class="totals">
  <div class="total-row">
    <span>Subtotal</span>
    <span>${money(invoice.subtotal)}</span>
  </div>

  <div class="total-row">
    <span>VAT</span>
    <span>${money(invoice.vat_amount)}</span>
  </div>

  <div class="total-row">
    <span>Total Due</span>
    <span>${money(invoice.total)}</span>
  </div>
</div>

${invoice.notes ? `
<div class="notes">
  <strong>Notes:</strong><br/>
  ${escapeHtml(invoice.notes)}
</div>
` : ''}

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

  const { invoice, project_id, invoice_id } = req.body || {};

  if (!invoice) {
    return res.status(400).json({
      error: 'No invoice provided',
    });
  }

  const projectId = project_id || invoice.project_id || null;
  const invoiceId = invoice_id || invoice.id || null;

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
            marginTop: '0.4in',
            marginRight: '0.4in',
            marginBottom: '0.4in',
            marginLeft: '0.4in',
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

    const fileRes = await fetch(pdfData.FileUrl);

    const arrayBuffer = await fileRes.arrayBuffer();

    const buffer = Buffer.from(arrayBuffer);

    const base64 = buffer.toString('base64');

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
      const { data: doc, error: docError } =
        await sb
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
      base64: `data:application/pdf;base64,${base64}`,
    });

  } catch (err) {
    return res.status(500).json({
      error:
        err?.message ||
        'Could not generate invoice PDF',
    });
  }
}
