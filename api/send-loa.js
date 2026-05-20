// api/send-loa.js
const FIRMA_API_BASE =
  process.env.FIRMA_API_URL ||
  'https://api.firma.dev/functions/v1/signing-request-api';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.FIRMA_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing FIRMA_API_KEY' });

    const body = req.body || {};
    const project_id       = body.project_id;
    const appointment_type = body.appointment_type;
    const rawDocumentName  = body.document_name || 'Letter of Appointment.pdf';
    const document_name    = rawDocumentName.replace(/\.docx$/i, '.pdf');
    const rawDocument      = body.pdf_b64 || body.document_base64 || body.pdf_base64 || body.docx_b64 || body.document || '';
    const documentBase64   = cleanBase64(rawDocument);

    if (!project_id)       return res.status(400).json({ error: 'Missing project_id' });
    if (!appointment_type) return res.status(400).json({ error: 'Missing appointment_type' });
    if (!documentBase64)   return res.status(400).json({ error: 'Missing document_base64' });

    const recipients = normaliseRecipients(body.signers || body.recipients || []);
    if (!recipients.length) return res.status(400).json({ error: 'At least one signer with an email is required' });

    const recipientsWithIds = recipients.map((r, i) => ({
      id: i === 0 ? 'temp_1' : 'temp_2',
      name: r.name,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      role: 'signer',
    }));

    // Place signature fields at bottom of last page using percentage positions.
    // page_number is set to 1 — works for single-page LoAs.
    // For multi-page LoAs this can be updated once we know the page count.
    // Anchor strings match text rendered into the PDF by buildLOAPlaceholders
    const isAO = appointment_type === 'ao_loa' || appointment_type === 'ao_agreed_surveyor_loa';
    const anchor1Date = isAO ? 'AO_1_DATE_HERE' : 'BO_1_DATE_HERE';
    const anchor1Sign = isAO ? 'AO_1_SIGN_HERE' : 'BO_1_SIGN_HERE';
    const anchor2Date = isAO ? 'AO_2_DATE_HERE' : 'BO_2_DATE_HERE';
    const anchor2Sign = isAO ? 'AO_2_SIGN_HERE' : 'BO_2_SIGN_HERE';

    const fields = [];
    fields.push({ type: 'date',      recipient_id: 'temp_1', required: true, page_number: 1, position: { x: 5,  y: 76, width: 30, height: 5 }, anchor_string: anchor1Date, anchor_x_offset: 0, anchor_y_offset: 0 });
    fields.push({ type: 'signature', recipient_id: 'temp_1', required: true, page_number: 1, position: { x: 5,  y: 83, width: 35, height: 8 }, anchor_string: anchor1Sign, anchor_x_offset: 0, anchor_y_offset: 0 });

    if (recipients.length >= 2) {
      fields.push({ type: 'date',      recipient_id: 'temp_2', required: true, page_number: 1, position: { x: 55, y: 76, width: 30, height: 5 }, anchor_string: anchor2Date, anchor_x_offset: 0, anchor_y_offset: 0 });
      fields.push({ type: 'signature', recipient_id: 'temp_2', required: true, page_number: 1, position: { x: 55, y: 83, width: 35, height: 8 }, anchor_string: anchor2Sign, anchor_x_offset: 0, anchor_y_offset: 0 });
    }

    const createPayload = {
      name: document_name,
      document: documentBase64,
      recipients: recipientsWithIds,
      fields,
    };

    console.log('[send-loa] Sending to Firma:', { name: document_name, recipients: recipientsWithIds.length, fields: fields.length, doc_length: documentBase64.length });

    const createRes = await fetch(`${FIRMA_API_BASE}/signing-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });

    const createData = await safeJson(createRes);

    console.log('[send-loa] Firma status:', createRes.status);
    console.log('[send-loa] Firma response:', JSON.stringify(createData));

    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: 'Failed to create Firma signing request', details: createData });
    }

    const signingRequestId = createData.id || createData.signing_request_id || createData.signingRequestId;
    if (!signingRequestId) return res.status(500).json({ error: 'Firma response missing signing request id', details: createData });

    console.log('[send-loa] Created:', signingRequestId);

    const sendRes = await fetch(`${FIRMA_API_BASE}/signing-requests/${signingRequestId}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_message: getCustomMessage(appointment_type) }),
    });

    const sendData = await safeJson(sendRes);
    console.log('[send-loa] Send status:', sendRes.status, JSON.stringify(sendData));

    if (!sendRes.ok) return res.status(sendRes.status).json({ error: 'Firma request created but failed to send', signing_request_id: signingRequestId, details: sendData });

    return res.status(200).json({ success: true, signing_request_id: signingRequestId });

  } catch (err) {
    console.error('[send-loa] fatal error:', err);
    return res.status(500).json({ error: 'send-loa fatal error', message: String(err) });
  }
}

function cleanBase64(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/^data:application\/pdf;base64,/, '').replace(/^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/, '').trim();
}

function normaliseRecipients(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(s => s && s.email).map(s => {
    const email = String(s.email).trim();
    const name  = String(s.name || deriveNameFromEmail(email)).trim();
    const parts = name.split(' ');
    return {
      name,
      first_name: parts[0] || name,
      last_name: parts.slice(1).join(' ') || '',
      email,
    };
  }).filter(s => s.email && s.name);
}

function deriveNameFromEmail(email) {
  return String(email || 'Signer').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || 'Signer';
}

function getCustomMessage(type) {
  if (type === 'bo_loa') return 'Please review and sign your Building Owner Letter of Appointment.';
  if (type === 'ao_loa') return 'Please review and sign your Adjoining Owner Letter of Appointment.';
  if (type === 'ao_agreed_surveyor_loa') return 'Please review and sign the Adjoining Owner appointment confirming appointment as Agreed Surveyor.';
  return 'Please review and sign this document.';
}

async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}
