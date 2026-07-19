// api/extract-doc.js
// Accepts multipart file upload — handles:
// - .docx/.doc: mammoth text extraction → Claude text analysis
// - .pdf: rendered as base64 → Claude Vision
// - .jpg/.jpeg/.png: base64 → Claude Vision (drawings)
// Returns structured JSON: project details + scope items

import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = { api: { bodyParser: false } };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Extract text from docx using mammoth
async function extractDocxText(bufferOrPath) {
  const mammoth = await import('mammoth');
  const result = Buffer.isBuffer(bufferOrPath)
    ? await mammoth.extractRawText({ buffer: bufferOrPath })
    : await mammoth.extractRawText({ path: bufferOrPath });
  return result.value;
}

// Get media type for Claude Vision
function getMediaType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

// Drawing prompts — one per drawing type
const PROMPTS = {

  general: `You are an experienced UK construction scope surveyor reading a set of architectural drawings to produce an accurate scope of works for pricing and programme purposes. This drawing set may include architectural plans, structural details, notes, elevations and sections all together — read everything provided before answering.

Follow this method, in order:

STEP 1 — SITE ADDRESS
Read the site address ONLY from the drawing's title block — the bordered information panel (almost always bottom-right or bottom corner of the sheet) containing the client name, project address, drawing number, scale and revision. Do NOT use house numbers or labels shown on a floor plan itself (e.g. "No 20", "No 22", "No 24" used only to identify neighbouring/adjoining properties for context on the plan) — those are never the site address, even if they appear larger or more prominent than the title block.

STEP 2 — READ EXISTING vs PROPOSED, FLOOR BY FLOOR
Where a floor plan is shown as both "existing" and "proposed" for the same floor (ground floor, first floor, loft, etc.), read them as a pair for that floor before moving to the next. For each floor:
- Note what each room was called and where it sat in the EXISTING plan
- Note what each room is called and where it sits in the PROPOSED plan
- Compare them by physical position on the page, not just by label — a room may keep its position but change function (e.g. an existing en-suite becomes the new family bathroom, and a new en-suite is formed elsewhere), or a wall/opening may move, or a room may be removed, extended or newly created
- Where the drawing includes explicit notes or annotations describing what is changing (e.g. "existing bathroom to become...", "form new opening", "remove wall"), use that wording directly — it is more reliable than inferring from position alone
- If a genuine change cannot be confidently determined from position or annotation alone, do not guess — describe only what is clearly shown

STEP 3 — ROOM LIST IS PROPOSED-ONLY
The "rooms" list in your output must reflect the PROPOSED layout only — every room as it will exist after the works, using its proposed label. Do not include existing-only rooms that cease to exist (e.g. a room being merged into another). Do not include both an existing and proposed version of the same physical space as two separate rooms.

STEP 4 — SCOPE ITEMS FOCUS ON WHAT IS CHANGING
Every scope item must describe genuine work arising from a difference between existing and proposed (or new-build work with no existing equivalent, e.g. an extension). Where a room's function is changing, say so plainly in the description (e.g. "Convert existing en-suite to family bathroom, including new sanitaryware and altered pipework" rather than two disconnected items). Do not list a room or feature as a scope item just because it appears on the proposed plan unchanged from existing — only list what is actually being built, altered, removed or reconfigured.

Also extract every other scope item visible across the full drawing set, using all notes, specification text and legends provided, including:
- New rooms, extensions, loft conversions, basement excavations
- Wall removals, new walls, structural openings, lintels
- New or altered bathrooms, en suites, cloakrooms, kitchens
- Sanitaryware: baths, showers, WCs, basins, trays, enclosures
- Electrical: sockets, switches, lights, consumer units, EV points, extractor fans
- Plumbing: boilers, cylinders, underfloor heating, radiators, pipework runs
- Roofing, windows, doors, glazing, bi-folds, rooflights
- Flooring, tiling, plastering, decorating
- Any structural elements: steels, beams, columns, foundations, retaining walls
- External works: drainage, paving, fencing, landscaping

Go floor by floor, area by area, across the entire drawing set. Do not skip anything. Do not split one body of work into multiple overlapping or duplicate scope items — consolidate related changes to the same area into a single clear item with a full description, rather than several fragments describing the same thing from different angles.

Return ONLY valid JSON with no markdown:
{
  "site_address": "from the title block only",
  "drawing_type": "general architectural",
  "rooms": ["every room from the PROPOSED layout only, by its proposed label"],
  "scope_items": [
    {
      "title": "item title",
      "description": "what is changing and why, including quantities, locations, spec where visible",
      "trade": "Architectural / Structural / Electrical / Plumbing / Finishes / External"
    }
  ]
}`,

  electrical: `You are reading an electrical plan. Your job is to extract a COMPLETE, COUNTED list of every electrical item visible.

STANDARD ELECTRICAL SYMBOLS TO COUNT:
- "2" next to outlet symbol = double switched socket outlet
- "1" next to outlet symbol = single switched socket outlet
- "P" = pendant ceiling light / ceiling rose
- "W" = wall light
- "R" = recessed downlight / spotlight
- "S" = switch (1-gang unless number shown)
- "2S" or "S2" = 2-gang switch
- "PIR" = PIR motion sensor
- "TV" = TV aerial point
- "CAT" or "DATA" = data/ethernet point
- "SPKR" = speaker point
- "EV" = electric vehicle charging point
- "DC" = doorbell/door chime
- "DB" = distribution board / consumer unit
- "T" = thermostat
- Shaver socket, extractor fan, electric towel rail, smoke detector — count each instance
- Height notations e.g. @450mm, @1050mm — note the height

CIRCUIT REFERENCES (C1, C2 etc.) are circuit labels — do NOT count as separate items.

METHOD: Go room by room, count every symbol, total per item type across all rooms.

Return ONLY valid JSON with no markdown:
{
  "site_address": "if visible",
  "drawing_type": "electrical plan",
  "rooms": ["list of rooms"],
  "scope_items": [
    {
      "title": "item title e.g. Double switched socket outlet",
      "description": "total count and room breakdown e.g. Kitchen 3, Living 4, Bedroom 1 2",
      "trade": "Electrical"
    }
  ]
}`,

  plumbing: `You are reading a plumbing or mechanical services drawing. Extract every plumbing, drainage, heating and water item visible.

Look for:
- Sanitaryware: baths, showers, shower trays, WCs, basins, bidets, urinals
- Kitchen: sink, dishwasher connection, washing machine connection
- Hot water: boiler (type/location), unvented cylinder, megaflo, thermal store
- Heating: radiators (count per room), underfloor heating zones, towel rails
- Pipework: soil pipes, waste pipes, hot/cold supplies, gas supply
- Drainage: gullies, manholes, inspection chambers, soakaways
- Ventilation: MVHR, extract fans, passive vents
- Specialist: water softener, heat pump, solar thermal, sprinkler system

Go room by room. Note quantities and locations.

Return ONLY valid JSON with no markdown:
{
  "site_address": "if visible",
  "drawing_type": "plumbing / mechanical",
  "rooms": ["list of rooms"],
  "scope_items": [
    {
      "title": "item title",
      "description": "detail including quantity, location, spec where visible",
      "trade": "Plumbing / Mechanical"
    }
  ]
}`,

  structural: `You are reading a structural drawing or engineers plan. Extract every structural element, alteration and specification visible.

Look for:
- Wall removals and new structural openings
- Steel beams (RSJ/UC/UB sections — note sizes if visible e.g. 203x203 UC)
- Padstone, bearing plates, spreader plates
- Columns and posts (steel, timber, concrete)
- Foundations: new, underpinning, pile caps, ground beams
- Retaining walls, basement construction
- Roof structure: rafters, joists, purlins, ridge beam, hip/valley rafters
- Floor structure: timber joists, steel trimmers, concrete slab
- Lintels: sizes and locations
- Temporary works notation
- Load paths and point loads
- Any demolition items noted

Note sizes, specifications and locations wherever visible.

Return ONLY valid JSON with no markdown:
{
  "site_address": "if visible",
  "drawing_type": "structural",
  "rooms": ["areas affected"],
  "scope_items": [
    {
      "title": "item title e.g. Steel beam over kitchen opening",
      "description": "spec, size, location e.g. 203x203 UC 46kg/m spanning 3.2m",
      "trade": "Structural"
    }
  ]
}`,

};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let fileBuffer, fileName, drawingType;

    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      // New path: browser uploaded the file directly to Supabase Storage
      // (bypasses Vercel's 4.5MB request body limit entirely). We just
      // download it here, server-side, with no such limit.
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const { storage_path, file_name, drawing_type } = body;
      if (!storage_path) return res.status(400).json({ error: 'No storage_path provided' });

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await supabase.storage.from('chat-temp-uploads').download(storage_path);
      if (error || !data) return res.status(400).json({ error: 'Could not download uploaded file: ' + (error?.message || 'not found') });

      fileBuffer = Buffer.from(await data.arrayBuffer());
      fileName = file_name || storage_path.split('/').pop();
      drawingType = drawing_type || 'general';

      // Clean up the temp file now that we've read it
      supabase.storage.from('chat-temp-uploads').remove([storage_path]).catch(() => {});
    } else {
      // Legacy path: small files sent directly as multipart/form-data.
      // Still subject to Vercel's ~4.5MB request body ceiling.
      const form = formidable({ maxFileSize: 20 * 1024 * 1024 }); // 20MB (app-level; platform ceiling is lower)
      const [fields, files] = await form.parse(req);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });

      fileBuffer = fs.readFileSync(file.filepath);
      fileName = file.originalFilename || file.newFilename || '';
      drawingType = (Array.isArray(fields.drawing_type) ? fields.drawing_type[0] : fields.drawing_type) || 'general';
    }

    const selectedPrompt = PROMPTS[drawingType] || PROMPTS.general;
    const ext = path.extname(fileName).toLowerCase();
    const isDrawing = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    const isPdf = ext === '.pdf';
    const isDocx = ['.docx', '.doc'].includes(ext);
    const isTxt = ext === '.txt';

    let rawJson = '';

    if (isDrawing || isPdf) {
      // Vision mode — drawings/PDFs go to GPT-5.6 Luna (cheap, capable multimodal
      // extraction — pattern/structure extraction from a drawing doesn't need
      // frontier reasoning depth). This is the ONLY branch routed to OpenAI —
      // text/docx extraction below stays on Claude.
      const base64Data = fileBuffer.toString('base64');
      const mediaType = getMediaType(fileName);
      const dataUrl = `data:${mediaType};base64,${base64Data}`;

      // GPT-4o accepts PDFs natively via the 'file' content type (extracts both
      // text and page images server-side). Plain images (jpg/png) use 'image_url'.
      // These are NOT interchangeable — sending a PDF as image_url silently
      // produces poor/garbled results rather than a clear error.
      const contentParts = isPdf
        ? [
            { type: 'text', text: selectedPrompt },
            { type: 'file', file: { filename: fileName || 'drawing.pdf', file_data: dataUrl } },
          ]
        : [
            { type: 'text', text: selectedPrompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ];

      const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-5.6-luna',
          max_completion_tokens: 4000,
          messages: [{
            role: 'user',
            content: contentParts,
          }],
        }),
      });

      if (!gptRes.ok) {
        const err = await gptRes.text();
        return res.status(500).json({ error: 'Luna drawing extraction failed', detail: err });
      }

      const gptData = await gptRes.json();
      rawJson = gptData?.choices?.[0]?.message?.content || '';
    } else {
      // Text mode — extract text first, then send to a model for structuring.
      // Toggle: EXTRACT_TEXT_USE_CLAUDE=true routes this to Claude Opus (higher
      // cost, was the original default). Unset/false = Luna (default as of
      // 19 July 2026 — cheaper, single-provider, testing quality before re-enabling
      // Claude as an option).
      let rawText = '';
      if (isDocx) {
        rawText = await extractDocxText(fileBuffer);
      } else if (isTxt) {
        rawText = fileBuffer.toString('utf8');
      } else {
        return res.status(400).json({ error: 'Unsupported file type. Use PDF, JPG, PNG, DOCX or TXT.' });
      }

      const truncated = rawText.slice(0, 40000);
      const useClaude = process.env.EXTRACT_TEXT_USE_CLAUDE === 'true';

      if (useClaude) {
        const claudeMessages = [{
          role: 'user',
          content: `${TEXT_PROMPT}\n\nDOCUMENT:\n${truncated}`
        }];

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25', // enable PDF support
          },
          body: JSON.stringify({
            model: 'claude-opus-4-6',
            max_tokens: 4000,
            messages: claudeMessages,
          }),
        });

        if (!claudeRes.ok) {
          const err = await claudeRes.text();
          return res.status(500).json({ error: 'Claude extraction failed', detail: err });
        }

        const claudeData = await claudeRes.json();
        rawJson = claudeData?.content?.[0]?.text || '';
      } else {
        const lunaRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-5.6-luna',
            max_completion_tokens: 4000,
            messages: [{ role: 'user', content: `${TEXT_PROMPT}\n\nDOCUMENT:\n${truncated}` }],
          }),
        });

        if (!lunaRes.ok) {
          const err = await lunaRes.text();
          return res.status(500).json({ error: 'Luna text extraction failed', detail: err });
        }

        const lunaData = await lunaRes.json();
        rawJson = lunaData?.choices?.[0]?.message?.content || '';
      }
    }

    const clean = rawJson.replace(/```json|```/g, '').trim();

    let extracted;
    try {
      extracted = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Could not parse Claude response', raw: clean });
    }

    // Flag drawing-sourced items
    if (isDrawing || isPdf) {
      extracted.source = 'drawing';
      if (extracted.scope_items) {
        extracted.scope_items = extracted.scope_items.map(item => ({
          ...item,
          from_drawing: true
        }));
      }
    } else {
      extracted.source = 'document';
    }

    if (typeof file !== 'undefined' && file?.filepath) {
      try { fs.unlinkSync(file.filepath); } catch {}
    }

    return res.status(200).json({ success: true, extracted });

  } catch (err) {
    console.error('[extract-doc] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
