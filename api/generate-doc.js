// api/generate-invoice-pdf.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API2PDF_KEY = process.env.API2PDF_API_KEY;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function money(value) {
  return `£${Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeFileName(value) {
  return String(value || 'Invoice').replace(/[^a-zA-Z0-9._\-\s]/g, '_').replace(/\s+/g, '_').slice(0, 120);
}

function buildInvoiceHtml(invoice, firm) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const invoiceNumber = invoice.invoice_number || invoice.id || '';

  const rows = items.map(item => {
    const qty = Number(item.qty || 0);
    const unit = Number(item.unitPrice ?? item.unit_price ?? 0);
    const total = Number(item.total ?? qty * unit);
    return `<tr>
      <td>${esc(item.description || '')}</td>
      <td class="num">${qty || ''}</td>
      <td class="num">${money(unit)}</td>
      <td class="num">${money(total)}</td>
    </tr>`;
  }).join('');

  const firmName = firm?.firm_name || firm?.trading_name || 'Square One Consulting';
  const firmAddress = firm?.address_line1 || '';
  const firmTel = firm?.tel || '';
  const firmEmail = firm?.email || '';
  const bankName = firm?.bank_name || '';
  const sortCode = firm?.sort_code || '';
  const accountNo = firm?.account_number || '';
  const footerText = firm?.footer_text || '';

  const subtotal = Number(invoice.subtotal || invoice.total || 0);
  const vatAmount = Number(invoice.vat_amount || 0);
  const total = Number(invoice.total || subtotal);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Invoice ${esc(invoiceNumber)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #1f2937;
    font-size: 12.5px;
    line-height: 1.5;
    padding: 36px 44px;
  }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 20px;
    border-bottom: 2.5px solid #1f3f77;
    margin-bottom: 24px;
  }
  .firm-name {
    font-size: 22px;
    font-weight: 700;
    color: #1f3f77;
    margin-bottom: 4px;
  }
  .firm-sub { color: #6b7280; font-size: 12px; margin-bottom: 2px; }
  .invoice-label {
    text-align: right;
    font-size: 30px;
    font-weight: 700;
    color: #1f2937;
    letter-spacing: 1px;
  }
  .invoice-number {
    text-align: right;
    font-size: 13px;
    color: #6b7280;
    margin-top: 4px;
  }

  /* ── Meta strip ── */
  .meta-strip {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }
  .meta-cell {
    flex: 1;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 12px;
    background: #f9fafb;
  }
  .meta-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    margin-bottom: 5px;
  }
  .meta-value { font-size: 12.5px; color: #111827; font-weight: 500; }

  /* ── Info boxes ── */
  .info-box {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 14px;
    background: #f9fafb;
    margin-bottom: 12px;
  }
  .box-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    margin-bottom: 6px;
  }
  .box-value { font-size: 12.5px; color: #111827; }
  .box-value strong { font-weight: 600; }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 0; }
  thead th {
    background: #f3f4f6;
    font-size: 10px;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 10px 12px;
    border-top: 1px solid #d1d5db;
    border-bottom: 1px solid #d1d5db;
    text-align: left;
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 12.5px;
    vertical-align: top;
    color: #374151;
  }
  .num { text-align: right; white-space: nowrap; }
  thead th.num { text-align: right; }

  /* ── Totals ── */
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 12px; margin-bottom: 24px; }
  .totals {
    width: 280px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    padding: 9px 14px;
    border-bottom: 1px solid #e5e7eb;
    font-size: 12.5px;
    color: #374151;
  }
  .total-row.grand {
    border-bottom: none;
    background: #1f3f77;
    color: #fff;
    font-weight: 700;
    font-size: 14px;
  }

  /* ── Footer bank + thank you ── */
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    margin-top: 8px;
  }
  .bank-section { display: flex; gap: 28px; }
  .bank-cell {}
  .bank-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    margin-bottom: 3px;
  }
  .bank-value { font-size: 12.5px; color: #111827; font-weight: 600; }
  .thank-you { font-size: 13px; color: #6b7280; font-style: italic; }
  .company-footer {
    font-size: 10px;
    color: #9ca3af;
    text-align: center;
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #f0f0f0;
  }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div>
    <div class="firm-name">${esc(firmName)}</div>
    ${firmAddress ? `<div class="firm-sub">${esc(firmAddress)}</div>` : ''}
    ${firmTel ? `<div class="firm-sub">${esc(firmTel)}</div>` : ''}
    ${firmEmail ? `<div class="firm-sub">${esc(firmEmail)}</div>` : ''}
  </div>
  <div>
    <div class="invoice-label">INVOICE</div>
    <div class="invoice-number">${esc(invoiceNumber)}</div>
  </div>
</div>

<!-- Meta strip -->
<div class="meta-strip">
  <div class="meta-cell">
    <div class="meta-label">Issued At Date</div>
    <div class="meta-value">${esc(invoice.invoice_date || '')}</div>
  </div>
  <div class="meta-cell">
    <div class="meta-label">Due Date</div>
    <div class="meta-value">${esc(invoice.due_date || '')}</div>
  </div>
  ${invoice.project_ref ? `<div class="meta-cell">
    <div class="meta-label">Project Ref</div>
    <div class="meta-value">${esc(invoice.project_ref)}</div>
  </div>` : ''}
  ${invoice.status ? `<div class="meta-cell">
    <div class="meta-label">Status</div>
    <div class="meta-value">${esc(invoice.status)}</div>
  </div>` : ''}
</div>

<!-- Bill To -->
<div class="info-box">
  <div class="box-label">Bill To</div>
  <div class="box-value">
    <strong>${esc(invoice.bill_to_name || '')}</strong><br/>
    ${esc(invoice.bill_to_address || '').replace(/\n/g, '<br/>')}
  </div>
</div>

<!-- In Respect Of -->
${invoice.property_address ? `<div class="info-box">
  <div class="box-label">In Respect Of</div>
  <div class="box-value">${esc(invoice.property_address).replace(/\n/g, '<br/>')}</div>
</div>` : ''}

<!-- Line items -->
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="num">Qty</th>
      <th class="num">Unit</th>
      <th class="num">Total</th>
    </tr>
  </thead>
  <tbody>
    ${rows || '<tr><td colspan="4" style="color:#9ca3af;font-style:italic;">No line items</td></tr>'}
  </tbody>
</table>

<!-- Totals -->
<div class="totals-wrap">
  <div class="totals">
    <div class="total-row">
      <span>Subtotal</span>
      <span>${money(subtotal)}</span>
    </div>
    ${vatAmount > 0 ? `<div class="total-row">
      <span>VAT</span>
      <span>${money(vatAmount)}</span>
    </div>` : ''}
    <div class="total-row grand">
      <span>Total Due</span>
      <span>${money(total)}</span>
    </div>
  </div>
</div>

<!-- Bank details + thank you -->
<div class="footer">
  <div class="bank-section">
    ${bankName ? `<div class="bank-cell">
      <div class="bank-label">Bank</div>
      <div class="bank-value">${esc(bankName)}</div>
    </div>` : ''}
    ${sortCode ? `<div class="bank-cell">
      <div class="bank-label">Sort Code</div>
      <div class="bank-value">${esc(sortCode)}</div>
    </div>` : ''}
    ${accountNo ? `<div class="bank-cell">
      <div class="bank-label">Account No.</div>
      <div class="bank-value">${esc(accountNo)}</div>
    </div>` : ''}
  </div>
  <div class="thank-you">Thank you for your business.</div>
</div>

${footerText ? `<div class="company-footer">${esc(footerText)}</div>` : ''}

${invoice.notes ? `<div style="margin-top:18px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#78350f;white-space:pre-wrap;">${esc(invoice.notes)}</div>` : ''}

</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase environment variables not configured' });
  if (!API2PDF_KEY) return res.status(500).json({ error: 'API2PDF_API_KEY not configured' });

  const { invoice, project_id, invoice_id } = req.body || {};
  if (!invoice) return res.status(400).json({ error: 'No invoice provided' });

  const sb = getSupabase();
  const projectId = project_id || invoice.project_id || null;
  const invoiceId = invoice_id || invoice.id || null;
  const invoiceNumber = invoice.invoice_number || invoice.id || Date.now();
  const fileName = safeFileName(`Invoice-${invoiceNumber}.pdf`);
  const storagePath = `${projectId || 'unlinked'}/invoices/${Date.now()}_${fileName}`;

  try {
    // Fetch firm settings including bank details
    const { data: firmData } = await sb
      .from('firm_settings')
      .select('firm_name, trading_name, address_line1, tel, email, footer_text, bank_name, sort_code, account_number')
      .limit(1);
    const firm = firmData?.[0] || {};

    const html = buildInvoiceHtml(invoice, firm);

    const pdfRes = await fetch('https://v2.api2pdf.com/chrome/pdf/html', {
      method: 'POST',
      headers: { Authorization: API2PDF_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        fileName,
        options: {
          printBackground: true,
          marginTop: '0.4in',
          marginRight: '0.45in',
          marginBottom: '0.4in',
          marginLeft: '0.45in',
          format: 'A4',
        },
      }),
    });

    const pdfData = await pdfRes.json();
    if (!pdfRes.ok || !pdfData?.FileUrl) {
      return res.status(500).json({ error: pdfData?.Message || pdfData?.error || 'PDF generation failed' });
    }

    const fileRes = await fetch(pdfData.FileUrl);
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    const { error: uploadError } = await sb.storage
      .from('documents')
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });

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
          metadata: { invoice_id: invoiceId, invoice_number: invoiceNumber, total: invoice.total || 0 },
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
    return res.status(500).json({ error: err?.message || 'Could not generate invoice PDF' });
  }
}
