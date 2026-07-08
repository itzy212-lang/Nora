import fs from 'node:fs';

function replaceOnce(file, from, to, label) {
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(to)) {
    console.log(`[patch-soc-export] Already applied: ${label}`);
    return;
  }
  if (!before.includes(from)) {
    throw new Error(`[patch-soc-export] Pattern not found for ${label} in ${file}`);
  }
  const after = before.replace(from, to);
  fs.writeFileSync(file, after, 'utf8');
  console.log(`[patch-soc-export] Applied ${label}`);
}

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
