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

function money(v) {
  return '£' + Number(v || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeFileName(v) {
  return String(v || 'Invoice')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function formatDate(v) {
  if (!v) return '';
  try {
    return new Date(v).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return String(v);
  }
}

function getInvoiceNumber(invoice) {
  const raw = invoice.invoice_number || invoice.id || '';
  if (!raw) return '';
  return String(raw).startsWith('INV-') ? String(raw) : `INV-${raw}`;
}

function statusLabel(status) {
  const raw = String(status || '').toLowerCase();
  if (raw === 'paid') return 'Paid';
  if (raw === 'void') return 'Void';
  if (raw === 'overdue') return 'Overdue';
  if (raw === 'draft') return 'Draft';
  return 'Awaiting Payment';
}

function mergeSettings(invoice, firm = {}, invoiceSettings = {}) {
  const firmAddress = [
    firm.address_line1,
    firm.address_line2,
    firm.city,
    firm.postcode,
  ].filter(Boolean).join(', ');

  return {
    firmName: invoice.firm_name || firm.firm_name || firm.trading_name || 'Square One Consulting',
    firmAddress: invoice.firm_address || firmAddress || 'Suite 28, 708a High Road, London, N12 9QL',
    firmPhone: invoice.firm_phone || firm.tel || firm.phone || '07889996841',
    firmEmail: invoice.firm_email || firm.email || 'help@sq1consulting.co.uk',
    bankName: invoice.bank_name || invoice.account_name || invoiceSettings.account_name || invoiceSettings.bank_name || firm.bank_name || 'Itzik Ltd',
    sortCode: invoice.sort_code || invoiceSettings.sort_code || firm.sort_code || '04-03-33',
    accountNo: invoice.account_number || invoice.account_no || invoiceSettings.account_number || firm.account_number || '67644868',
    thankYou: invoice.invoice_notes || invoiceSettings.invoice_notes || 'Thank you for your business.',
    footer: invoice.footer_text || firm.footer_text || 'Square One Consulting is a trading division of Itzik Ltd | Registered in England & Wales',
  };
}

function buildInvoiceHtml(invoice, firm, invoiceSettings) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const invNo = getInvoiceNumber(invoice);
  const projectRef = invoice.project_ref || invoice.ref || invoice.project_reference || '';
  const s = mergeSettings(invoice, firm, invoiceSettings);

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
        <td class="td-r">${qty || ''}</td>
        <td class="td-r">${money(unit)}</td>
        <td class="td-r">${money(total)}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(invNo || 'Invoice')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:Arial,Helvetica,sans-serif;
    color:#1a1a2e;
    font-size:11.5px;
    line-height:1.55;
    padding:40px 48px;
    background:#fff;
  }

  .hdr{
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    padding-bottom:20px;
    border-bottom:2.5px solid #1e3a6e;
    margin-bottom:26px;
  }
  .firm-name{font-size:21px;font-weight:700;color:#1e3a6e;margin-bottom:5px;}
  .firm-line{font-size:11.5px;color:#555;margin-bottom:1px;}
  .inv-right{text-align:right;}
  .inv-word{font-size:32px;font-weight:700;color:#1a1a2e;letter-spacing:3px;}
  .inv-num{font-size:13px;color:#6b7280;margin-top:4px;}

  .meta{
    display:flex;
    gap:0;
    border:1px solid #dde1e9;
    border-radius:8px;
    overflow:hidden;
    margin-bottom:20px;
  }
  .mc{
    flex:1;
    padding:11px 14px;
    border-right:1px solid #dde1e9;
    background:#f7f8fc;
  }
  .mc:last-child{border-right:none;}
  .ml{
    font-size:8.5px;
    font-weight:700;
    color:#9ca3af;
    letter-spacing:1.8px;
    text-transform:uppercase;
    margin-bottom:5px;
  }
  .mv{font-size:12px;color:#111827;font-weight:600;}

  .box{
    border:1px solid #dde1e9;
    border-radius:8px;
    padding:12px 16px;
    background:#f7f8fc;
    margin-bottom:14px;
  }
  .bl{
    font-size:8.5px;
    font-weight:700;
    color:#9ca3af;
    letter-spacing:1.8px;
    text-transform:uppercase;
    margin-bottom:6px;
  }
  .bv{font-size:12px;color:#111827;}
  .bv strong{font-weight:700;}

  table{width:100%;border-collapse:collapse;margin-bottom:4px;}
  thead tr{background:#1e3a6e;}
  th{
    color:#fff;
    font-size:8.5px;
    letter-spacing:1.4px;
    text-transform:uppercase;
    font-weight:700;
    padding:10px 12px;
    text-align:left;
  }
  th.th-r{text-align:right;}
  .td-desc{
    padding:10px 12px;
    border-bottom:1px solid #eef0f5;
    color:#374151;
    font-size:11.5px;
    vertical-align:top;
  }
  .td-r{
    padding:10px 12px;
    border-bottom:1px solid #eef0f5;
    text-align:right;
    white-space:nowrap;
    font-size:11.5px;
    color:#374151;
    vertical-align:top;
  }

  .totals-wrap{display:flex;justify-content:flex-end;margin:14px 0 28px;}
  .totals{width:260px;border:1px solid #dde1e9;border-radius:8px;overflow:hidden;}
  .tr{
    display:flex;
    justify-content:space-between;
    padding:9px 14px;
    font-size:12px;
    border-bottom:1px solid #eef0f5;
    color:#374151;
  }
  .tr.grand{
    background:#1e3a6e;
    color:#fff;
    font-weight:700;
    font-size:14px;
    border-bottom:none;
    padding:11px 14px;
  }

  .footer{
    display:flex;
    justify-content:space-between;
    align-items:flex-end;
    padding-top:16px;
    border-top:1.5px solid #dde1e9;
  }
  .bank-row{display:flex;gap:32px;}
  .bc .bl{margin-bottom:4px;}
  .bc .bv{font-size:12px;font-weight:700;color:#111827;}
  .thankyou{font-size:12.5px;color:#6b7280;font-style:italic;}
  .company-reg{
    margin-top:18px;
    font-size:9.5px;
    color:#b0b7c3;
    text-align:center;
    padding-top:10px;
    border-top:1px solid #f0f0f5;
  }
</style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="firm-name">${esc(s.firmName)}</div>
    ${s.firmAddress ? `<div class="firm-line">${esc(s.firmAddress)}</div>` : ''}
    ${s.firmPhone ? `<div class="firm-line">${esc(s.firmPhone)}</div>` : ''}
    ${s.firmEmail ? `<div class="firm-line">${esc(s.firmEmail)}</div>` : ''}
  </div>
  <div class="inv-right">
    <div class="inv-word">INVOICE</div>
    <div class="inv-num">${esc(invNo)}</div>
  </div>
</div>

<div class="meta">
  <div class="mc">
    <div class="ml">Issued Date</div>
    <div class="mv">${esc(formatDate(invoice.invoice_date))}</div>
  </div>
  <div class="mc">
    <div class="ml">Due Date</div>
    <div class="mv">${esc(formatDate(invoice.due_date))}</div>
  </div>
  <div class="mc">
    <div class="ml">Project Ref</div>
    <div class="mv">${esc(projectRef)}</div>
  </div>
  <div class="mc">
    <div class="ml">Status</div>
    <div class="mv">${esc(statusLabel(invoice.status))}</div>
  </div>
</div>

<div class="box">
  <div class="bl">Bill To</div>
  <div class="bv">
    <strong>${esc(invoice.bill_to_name || '')}</strong><br/>
    ${esc(invoice.bill_to_address || '').replace(/\\n/g, '<br/>')}
  </div>
</div>

<div class="box">
  <div class="bl">In Respect Of</div>
  <div class="bv">
    ${esc(invoice.property_address || '').replace(/\\n/g, '<br/>')}<br/>
    Party wall surveyor services
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="th-r">Qty</th>
      <th class="th-r">Unit</th>
      <th class="th-r">Total</th>
    </tr>
  </thead>
  <tbody>
    ${rows || `<tr><td class="td-desc" colspan="4" style="color:#9ca3af;font-style:italic;">No line items</td></tr>`}
  </tbody>
</table>

<div class="totals-wrap">
  <div class="totals">
    <div class="tr"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    ${vatAmt > 0 ? `<div class="tr"><span>VAT</span><span>${money(vatAmt)}</span></div>` : ''}
    <div class="tr grand"><span>Total Due</span><span>${money(totalDue)}</span></div>
  </div>
</div>

<div class="footer">
  <div class="bank-row">
    <div class="bc"><div class="bl">Bank</div><div class="bv">${esc(s.bankName)}</div></div>
    <div class="bc"><div class="bl">Sort Code</div><div class="bv">${esc(s.sortCode)}</div></div>
    <div class="bc"><div class="bl">Account No.</div><div class="bv">${esc(s.accountNo)}</div></div>
  </div>
  <div class="thankyou">${esc(s.thankYou)}</div>
</div>

<div class="company-reg">${esc(s.footer)}</div>

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
          marginTop: '0.4in',
          marginRight: '0.5in',
          marginBottom: '0.4in',
          marginLeft: '0.5in',
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

    // Try OneDrive upload (non-blocking — failure does not affect invoice generation)
    if (projectId) {
      try {
        const { data: proj } = await sb.from('projects').select('onedrive_folder_id').eq('id', projectId).maybeSingle();
        const folderId = proj?.onedrive_folder_id;
        if (folderId) {
          const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://nora-d9wy.vercel.app';
          await fetch(baseUrl + '/api/onedrive-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: 'help@sq1consulting.co.uk',
              folder_id: folderId,
              filename: fileName,
              content_base64: base64,
              content_type: 'application/pdf',
            }),
          });
        }
      } catch (odErr) {
        console.warn('[generate-invoice-pdf] OneDrive upload failed (non-fatal):', odErr.message);
      }
    }

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
