/**
 * DualAIReviewOverlay
 * Shows Claude's corrections and additions to GPT's extraction.
 * Left column = GPT version, Right column = Claude's fix, highlighted diff.
 * Each row has a tick — ticking accepts Claude's version immediately.
 * Unticked rows keep GPT's version on finalise.
 */

import { useState, useCallback } from 'react';

function highlightDiff(original, corrected) {
  // Simple word-level diff highlight
  if (!original || !corrected) return { original, corrected };
  const origWords = original.split(' ');
  const corrWords = corrected.split(' ');
  return { original, corrected };
}

function DiffText({ gptText, claudeText, side }) {
  // Highlight the specific changed portion
  if (!gptText && !claudeText) return <span>{side === 'gpt' ? '—' : '—'}</span>;
  
  const text = side === 'gpt' ? gptText : claudeText;
  const other = side === 'gpt' ? claudeText : gptText;
  
  if (!text) return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>—</span>;
  
  // Split into parts — highlight the differing word/phrase
  const isChanged = text !== other;
  
  return (
    <span>
      {isChanged ? (
        <mark style={{
          background: side === 'gpt' ? '#fef3c7' : '#d1fae5',
          padding: '1px 3px',
          borderRadius: 3,
          fontWeight: 500,
        }}>
          {text}
        </mark>
      ) : text}
    </span>
  );
}

export default function DualAIReviewOverlay({ diff, gptItems, onFinalise, onClose }) {
  const { corrections = [], additions = [], notes } = diff;

  // Track which corrections are accepted (ticked)
  const [acceptedCorrections, setAcceptedCorrections] = useState(new Set());
  const [acceptedAdditions, setAcceptedAdditions] = useState(new Set());
  const [finalising, setFinalising] = useState(false);

  const toggleCorrection = useCallback((idx) => {
    setAcceptedCorrections(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }, []);

  const toggleAddition = useCallback((idx) => {
    setAcceptedAdditions(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }, []);

  const handleFinalise = useCallback(async () => {
    setFinalising(true);

    // Build final items — start with GPT's full list
    const finalItems = [...gptItems];

    // Apply accepted corrections
    for (const idx of acceptedCorrections) {
      const correction = corrections[idx];
      const itemIdx = correction.gpt_item_index;
      if (finalItems[itemIdx]) {
        // Apply Claude's correction to the relevant field
        if (correction.changed_field === 'title') {
          finalItems[itemIdx] = { ...finalItems[itemIdx], title: correction.claude_version };
        } else if (correction.changed_field === 'description') {
          finalItems[itemIdx] = { ...finalItems[itemIdx], description: correction.claude_version };
        } else {
          // General correction — replace title with claude_version
          finalItems[itemIdx] = { ...finalItems[itemIdx], title: correction.claude_version };
        }
      }
    }

    // Add accepted additions
    for (const idx of acceptedAdditions) {
      const addition = additions[idx];
      finalItems.push({
        title: addition.title,
        description: addition.description || null,
        trade: addition.trade || null,
        from_drawing: true,
        extracted_by_ai: true,
      });
    }

    await onFinalise(finalItems);
    setFinalising(false);
  }, [acceptedCorrections, acceptedAdditions, corrections, additions, gptItems, onFinalise]);

  const hasIssues = corrections.length > 0 || additions.length > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        width: '100%',
        maxWidth: 900,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Dual AI Review</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              Claude has checked GPT's extraction.
              {hasIssues
                ? ` Found ${corrections.length} correction${corrections.length !== 1 ? 's' : ''} and ${additions.length} addition${additions.length !== 1 ? 's' : ''}.`
                : ' No issues found.'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>×</button>
        </div>

        {/* Notes banner */}
        {notes && (
          <div style={{ padding: '10px 24px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
            💡 {notes}
          </div>
        )}

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>

          {!hasIssues && (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 600 }}>Claude found no issues with GPT's extraction.</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>All items look correct. Hit Finalise to save.</div>
            </div>
          )}

          {/* Corrections */}
          {corrections.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 12 }}>
                Corrections ({corrections.length})
              </div>

              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 40px',
                gap: 8,
                marginBottom: 6,
                padding: '0 10px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>GPT's version</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Claude's correction</div>
                <div />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {corrections.map((c, idx) => {
                  const accepted = acceptedCorrections.has(idx);
                  return (
                    <div key={idx} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 40px',
                      gap: 8,
                      alignItems: 'start',
                      padding: 10,
                      borderRadius: 8,
                      border: `1px solid ${accepted ? '#86efac' : '#e5e7eb'}`,
                      background: accepted ? '#f0fdf4' : '#fafafa',
                      transition: 'all 0.15s',
                    }}>
                      {/* GPT column */}
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                        {c.gpt_version && c.gpt_text
                          ? c.gpt_version.split(c.gpt_text).map((part, i, arr) => (
                              <span key={i}>
                                {part}
                                {i < arr.length - 1 && (
                                  <mark style={{ background: '#fef3c7', padding: '1px 3px', borderRadius: 3 }}>
                                    {c.gpt_text}
                                  </mark>
                                )}
                              </span>
                            ))
                          : c.gpt_version || '—'}
                        {c.reason && (
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{c.reason}</div>
                        )}
                      </div>

                      {/* Claude column */}
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                        {c.claude_version && c.claude_text
                          ? c.claude_version.split(c.claude_text).map((part, i, arr) => (
                              <span key={i}>
                                {part}
                                {i < arr.length - 1 && (
                                  <mark style={{ background: '#d1fae5', padding: '1px 3px', borderRadius: 3 }}>
                                    {c.claude_text}
                                  </mark>
                                )}
                              </span>
                            ))
                          : c.claude_version || '—'}
                      </div>

                      {/* Tick */}
                      <button
                        onClick={() => toggleCorrection(idx)}
                        title={accepted ? 'Undo' : 'Accept correction'}
                        style={{
                          width: 32, height: 32,
                          borderRadius: '50%',
                          border: `2px solid ${accepted ? '#22c55e' : '#d1d5db'}`,
                          background: accepted ? '#22c55e' : '#fff',
                          color: accepted ? '#fff' : '#9ca3af',
                          cursor: 'pointer',
                          fontSize: 16,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }}
                      >✓</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Additions */}
          {additions.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 12 }}>
                Missing items Claude found ({additions.length})
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 40px',
                gap: 8,
                marginBottom: 6,
                padding: '0 10px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>GPT's version</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Claude found</div>
                <div />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {additions.map((a, idx) => {
                  const accepted = acceptedAdditions.has(idx);
                  return (
                    <div key={idx} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 40px',
                      gap: 8,
                      alignItems: 'start',
                      padding: 10,
                      borderRadius: 8,
                      border: `1px solid ${accepted ? '#86efac' : '#e5e7eb'}`,
                      background: accepted ? '#f0fdf4' : '#fafafa',
                      transition: 'all 0.15s',
                    }}>
                      {/* GPT column — blank, item was missing */}
                      <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
                        Not found by GPT
                      </div>

                      {/* Claude column */}
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                        <mark style={{ background: '#d1fae5', padding: '1px 3px', borderRadius: 3 }}>
                          {a.title}
                        </mark>
                        {a.description && (
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{a.description}</div>
                        )}
                        {a.reason && (
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{a.reason}</div>
                        )}
                      </div>

                      {/* Tick */}
                      <button
                        onClick={() => toggleAddition(idx)}
                        title={accepted ? 'Undo' : 'Add this item'}
                        style={{
                          width: 32, height: 32,
                          borderRadius: '50%',
                          border: `2px solid ${accepted ? '#22c55e' : '#d1d5db'}`,
                          background: accepted ? '#22c55e' : '#fff',
                          color: accepted ? '#fff' : '#9ca3af',
                          cursor: 'pointer',
                          fontSize: 16,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }}
                      >✓</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          background: '#f9fafb',
        }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {acceptedCorrections.size + acceptedAdditions.size} change{acceptedCorrections.size + acceptedAdditions.size !== 1 ? 's' : ''} accepted
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => onFinalise(gptItems)}
              disabled={finalising}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                color: '#374151',
              }}
            >
              Use GPT only
            </button>
            <button
              onClick={handleFinalise}
              disabled={finalising}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#3b82f6',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: finalising ? 'not-allowed' : 'pointer',
                opacity: finalising ? 0.7 : 1,
              }}
            >
              {finalising ? 'Saving…' : 'Finalise'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
