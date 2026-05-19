// api/send-loa.js
const FIRMA_API_BASE =
  process.env.FIRMA_API_URL ||
  'https://api.firma.dev/functions/v1/signing-request-api';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.FIRMA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing FIRMA_API_KEY' });
    }

    const body = req.body || {};
    const project_id       = body.project_id;
    const appointment_type = body.appointment_type;
    const template_key     = body.template_key;
    const rawDocumentName  = body.document_name || 'Letter of Appointment.pdf';
    const document_name    = rawDocumentName.replace(/\.docx$/i, '.pdf');
    const rawDocument      = body.pdf_b64 || body.document_base64 || body.pdf_base64 || body.docx_b64 || body.document || '';
    const documentBase64   = cleanBase64(rawDocument);

    if (!project_id)       return res.status(400).json({ error: 'Missing project_id' });
    if (!appointment_type) return res.status(400).json({ error: 'Missing appointment_type' });
    if (!documentBase64)   return res.status(400).json({ error: 'Missing document_base64', received_keys: Object.keys(body) });

    const recipients = normaliseRecipients(body.signers || body.recipients || []);
    if (!recipients.length) return res.status(400).json({ error: 'At least one signer with an email is required' });

    // ── ANCHOR TAGS ───────────────────────────────────────────
    const anchorTags = [];

    anchorTags.push({ anchor_string: 'BO_1_SIGN_HERE', type: 'signature', recipient_id: 'temp_1', required: true, offset_x: 0, offset_y: -4, width: 33, height: 5 });
    anchorTags.push({ anchor_string: 'BO_1_DATE_HERE', type: 'date',      recipient_id: 'temp_1', required: true, offset_x: 0, offset_y: -4, width: 23, height: 5 });

    if (recipients.length >= 2) {
      anchorTags.push({ anchor_string: 'BO_2_SIGN_HERE', type: 'signature', recipient_id: 'temp_2', required: true, offset_x: 0, offset_y: -4, width: 33, height: 5 });
      anchorTags.push({ anchor_string: 'BO_2_DATE_HERE', type: 'date',      recipient_id: 'temp_2', required: true, offset_x: 0, offset_y: -4, width: 23, height: 5 });
    }

    const recipientsWithIds = recipients.map((r, i) => ({ ...r, id: i === 0 ? 'temp_1' : 'temp_2' }));

    const isPdf = (() => {
      try { return Buffer.from(documentBase64.slice(0, 8), 'base64').toString('ascii').startsWith('%PDF'); }
      catch { return false; }
    })();

    if (!isPdf) console.warn('[send-loa] WARNING: document does not appear to be PDF');

    // ── CREATE SIGNING REQUEST ────────────────────────────────
    const createPayload = {
      name: document_name, title: document_name,
      document: documentBase64, filename: document_name,
      recipients: recipientsWithIds,
      anchor_tags: anchorTags,
      metadata: { project_id, appointment_type, template_key: template_key || '' }
    };

    const createRes = await fetch(`${FIRMA_API_BASE}/signing-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload)
    });

    const createData = await safeJson(createRes);
    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: 'Failed to create Firma signing request', details: createData });
    }

    const signingRequestId = createData.id || createData.signing_request_id || createData.signingRequestId;
    if (!signingRequestId) return res.status(500).json({ error: 'Firma response missing signing request id', details: createData });

    // ── SEND TO SIGNERS ───────────────────────────────────────
    const sendRes = await fetch(`${FIRMA_API_BASE}/signing-requests/${signingRequestId}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_message: getCustomMessage(appointment_type) })
    });

    const sendData = await safeJson(sendRes);
    if (!sendRes.ok) {
      return res.status(sendRes.status).json({ error: 'Firma request created but failed to send', signing_request_id: signingRequestId, details: sendData });
    }

    return res.status(200).json({ success: true, signing_request_id: signingRequestId, create_result: createData, send_result: sendData });

  } catch (err) {
    console.error('[send-loa] fatal error:', err);
    return res.status(500).json({ error: 'send-loa fatal error', message: err instanceof Error ? err.message : String(err) });
  }
}

function cleanBase64(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/^data:application\/pdf;base64,/, '').replace(/^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/, '').trim();
}

function normaliseRecipients(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(s => s && s.email).map((s, index) => {
    const email = String(s.email).trim();
    const name = String(s.name || s.full_name || s.owner_name || s.signer_name || deriveNameFromEmail(email)).trim();
    const nameParts = name.split(' ');
    return { name, first_name: nameParts[0] || name, last_name: nameParts.slice(1).join(' ') || '', email, designation: 'Signer', role: s.role || 'signer', order: s.order || index + 1 };
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
