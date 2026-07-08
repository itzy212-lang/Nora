import fs from 'node:fs';

function replaceOnce(file, from, to, label) {
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes(from)) {
    throw new Error(`[patch-soc-fixes] Pattern not found for ${label} in ${file}`);
  }
  const after = before.replace(from, to);
  fs.writeFileSync(file, after, 'utf8');
  console.log(`[patch-soc-fixes] Applied ${label}`);
}

// 1. SOC editable preview export fix
// The Download and Email handlers use editableSections/getRenderedHtml. Without these
// dependencies React can retain a stale callback and export the original generated SOC
// instead of the edited preview.
replaceOnce(
  'src/components/soc/SOC.jsx',
  `  }, [previewHtml, projectAddress, selectedAOAddress]);`,
  `  }, [editableSections, getRenderedHtml, previewHtml, projectAddress, selectedAOAddress]);`,
  'SOC printPreview dependencies'
);

replaceOnce(
  'src/components/soc/SOC.jsx',
  `  }, [onOpenComposer, previewHtml, projectAddress, projectId, selectedAO, selectedAOAddress]);`,
  `  }, [editableSections, getRenderedHtml, onOpenComposer, previewHtml, projectAddress, projectId, selectedAO, selectedAOAddress]);`,
  'SOC handleSaveAndEmail dependencies'
);

// 2. SOC section inference safety fix
// These aliases were too broad and caused invented sections, e.g. "ground floor"
// becoming "Ground Floor Rear Extension", and "rear bedroom" becoming
// "First Floor Rear Bedroom" even where no floor level had been dictated.
replaceOnce(
  'api/lib/soc-pipeline.js',
  `  'ground floor':                 'Ground Floor Rear Extension',\n`,
  `  // Do not map broad "ground floor" wording to a rear extension.\n  // The model must only use Ground Floor Rear Extension where expressly stated\n  // or clearly established by active section context.\n`,
  'remove unsafe ground floor alias'
);

replaceOnce(
  'api/lib/soc-pipeline.js',
  `  'rear bedroom':                 'First Floor Rear Bedroom',\n`,
  `  // Do not map broad "rear bedroom" wording to first floor.\n  // Preserve "Rear Bedroom" unless first floor is expressly stated or clearly established.\n`,
  'remove unsafe rear bedroom alias'
);

replaceOnce(
  'api/lib/soc-pipeline.js',
  `  'front bedroom':                'First Floor Front Elevation Room',\n`,
  `  // Do not map broad "front bedroom" wording to first floor.\n  // Preserve "Front Bedroom" unless first floor is expressly stated or clearly established.\n`,
  'remove unsafe front bedroom alias'
);

replaceOnce(
  'api/lib/soc-pipeline.js',
  `SECTION NAMES — use exactly:\nGround Floor Front Elevation Room | Ground Floor Rear Elevation Room | Ground Floor Rear Extension | Ground Floor Rear Outrigger | Ground Floor Rear Outrigger Kitchen | First Floor Rear Bedroom | First Floor Rear Bathroom | First Floor Front Elevation Room | External Areas\n\nSELF-CORRECTION / FALSE STARTS — critical rule:`,
  `SECTION NAMES — use exactly:\nGround Floor Front Elevation Room | Ground Floor Rear Elevation Room | Ground Floor Rear Extension | Ground Floor Rear Outrigger | Ground Floor Rear Outrigger Kitchen | First Floor Rear Bedroom | First Floor Rear Bathroom | First Floor Front Elevation Room | External Areas\n\nSECTION INFERENCE SAFETY — critical rule:\nDo not infer a floor level, extension, room type or elevation unless it is explicitly stated or clearly established by active section context.\nDo not infer "Ground Floor Rear Extension" from the words "ground floor" alone.\nDo not infer "First Floor Rear Bedroom" from "rear bedroom" alone unless the dictation says first floor or the active section context is already first floor.\nDo not infer "First Floor Front Elevation Room" from "front bedroom" alone unless the dictation says first floor or the active section context is already first floor.\nWhere the floor level is not stated, preserve the room name without adding a floor level, or flag the note as needing review.\n\nSELF-CORRECTION / FALSE STARTS — critical rule:`,
  'add extraction section inference safety rule'
);

replaceOnce(
  'api/lib/soc-pipeline.js',
  `Read the complete inspection record as a whole. Use the structured claims as the factual authority and completeness checklist. Use the raw notes, sequence and context to understand the inspection. Then write the Schedule of Conditions from first principles as an experienced Party Wall Surveyor would write it.`,
  `Read the complete inspection record as a whole. Use the structured claims as the factual authority and completeness checklist. Use the raw notes, sequence and context to understand the inspection. Then write the Schedule of Conditions from first principles as an experienced Party Wall Surveyor would write it.\n\nDo not infer a floor level, extension, room type or elevation unless it is explicitly stated or clearly established by active section context. Where the floor level is not stated, preserve the room name without adding a floor level, or flag the note for review rather than inventing a floor level.`,
  'add drafting section inference safety rule'
);

console.log('[patch-soc-fixes] SOC fixes applied successfully.');
