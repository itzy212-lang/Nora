// api/firma-webhook.js
// Receives webhook events from Firma.dev when LOA signing events occur
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const FIRMA_API_BASE = process.env.FIRMA_API_URL || 'https://api.firma.dev/functions/v1/signing-request-api';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Verify Firma webhook signature
function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return true; // skip if not configured
  try {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}

// Download signed PDF from Firma
async function downloadSignedPdf(signingRequestId, apiKey) {
  try {
    const res = await fetch(`${FIRMA_API_BASE}/signing-requests/${signingRequestId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const url = data.final_document_download_url || data.document_only_download_url || data.download_url;
    if (!url) return null;

    const pdfRes = await fetch(url);
    if (!pdfRes.ok) return null;

    const buffer = await pdfRes.arrayBuffer();
    return { buffer: Buffer.from(buffer), url };
  } catch (err) {
    console.warn('[firma-webhook] PDF download failed:', err.message);
    return null;
  }
}

// Save signed PDF to Supabase storage and return public URL
async function savePdfToStorage(sb, projectId, pdfBuffer, filename) {
  try {
    const path = `projects/${projectId}/loa/${filename}`;
    const { error } = await sb.storage.from('documents').upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) throw error;

    const { data } = sb.storage.from('documents').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.warn('[firma-webhook] Storage save failed:', err.message);
    return null;
  }
}

// Upload to OneDrive via Nora's existing onedrive-upload endpoint
async function saveToOneDrive(projectId, pdfBuffer, filename, baseUrl) {
  try {
    const base64 = pdfBuffer.toString('base64');
    const res = await fetch(`${baseUrl}/api/onedrive-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        file_name: filename,
        file_base64: base64,
        mime_type: 'application/pdf',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[firma-webhook] OneDrive upload failed:', err);
    }
  } catch (err) {
    console.warn('[firma-webhook] OneDrive upload error:', err.message);
  }
}

export default async function handler(req, res) {
  // Always respond 200 immediately so Firma doesn't retry
  res.status(200).json({ received: true });

  try {
    if (req.method !== 'POST') return;

    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-firma-signature'] || req.headers['x-firma-signature-256'] || '';
    const webhookSecret = process.env.FIRMA_WEBHOOK_SECRET || '';

    if (webhookSecret && !verifySignature(rawBody, signature, webhookSecret)) {
      console.warn('[firma-webhook] Signature verification failed');
      return;
    }

    const event = req.body || {};
    const eventType = event.event || event.type || '';
    const signingRequestId = event.signing_request_id || event.data?.signing_request_id || event.id;

    console.log('[firma-webhook] Event:', eventType, signingRequestId);

    // Only handle completion events
    if (!['signing_request.completed', 'signing_request.all_signed', 'completed'].includes(eventType)) return;
    if (!signingRequestId) return;

    const sb = getSupabase();
    const apiKey = process.env.FIRMA_API_KEY;
    const now = new Date().toISOString();

    // Find the project/AO by signing_request_id
    const [projectResult, aoResult] = await Promise.all([
      sb.from('projects').select('id, ref, bo_premise_address').eq('bo_loa_signing_request_id', signingRequestId).single(),
      sb.from('adjoining_owners').select('id, project_id, name').eq('loa_signing_request_id', signingRequestId).single(),
    ]);

    const isBO = !projectResult.error && projectResult.data;
    const isAO = !aoResult.error && aoResult.data;

    if (!isBO && !isAO) {
      console.warn('[firma-webhook] No matching project/AO for signing_request_id:', signingRequestId);
      return;
    }

    const projectId = isBO ? projectResult.data.id : aoResult.data.project_id;
    const projectRef = isBO ? projectResult.data.ref : null;
    const address = isBO ? (projectResult.data.bo_premise_address || 'Property') : (aoResult.data.name || 'AO');
    const filename = `LOA - ${address} - Signed.pdf`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Download signed PDF
    const pdfResult = apiKey ? await downloadSignedPdf(signingRequestId, apiKey) : null;
    let pdfUrl = null;

    if (pdfResult?.buffer) {
      // Save to Supabase storage
      pdfUrl = await savePdfToStorage(sb, projectId, pdfResult.buffer, filename);

      // Save to OneDrive
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://nora-d9wy.vercel.app';
      await saveToOneDrive(projectId, pdfResult.buffer, filename, baseUrl);
    }

    // Update Supabase with signed status
    if (isBO) {
      await sb.from('projects').update({
        bo_loa_signed_at: now,
        bo_loa_signed_pdf_url: pdfUrl,
      }).eq('id', projectId);
    } else {
      await sb.from('adjoining_owners').update({
        loa_signed_at: now,
        loa_signed_pdf_url: pdfUrl,
      }).eq('id', aoResult.data.id);
    }

    console.log('[firma-webhook] LOA signed —', isBO ? 'BO' : 'AO', projectId, pdfUrl ? '(PDF saved)' : '(no PDF)');

  } catch (err) {
    console.error('[firma-webhook] Error:', err.message);
  }
}
