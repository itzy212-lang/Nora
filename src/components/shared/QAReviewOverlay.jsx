import { useCallback, useMemo, useState } from 'react';

function displayText(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export default function QAReviewOverlay({
  title = 'QA Review Mode',
  subtitle,
  recommendations = [],
  notes = '',
  reviewerName = 'Claude',
  primaryAuthorName = 'GPT',
  onFinalise,
  onClose,
}) {
  const [acceptedIds, setAcceptedIds] = useState(() => new Set());
  const [finalising, setFinalising] = useState(false);

  const recommendationIds = useMemo(
    () => recommendations.map((rec, idx) => rec.id || `recommendation-${idx}`),
    [recommendations]
  );

  const toggleRecommendation = useCallback((id) => {
    setAcceptedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const emitDecision = useCallback(async (action) => {
    setFinalising(true);
    try {
      const acceptedRecommendationIds = action === 'use_original' ? [] : Array.from(acceptedIds);
      const acceptedSet = new Set(acceptedRecommendationIds);
      const dismissedRecommendationIds = recommendationIds.filter(id => !acceptedSet.has(id));
      await onFinalise?.({
        action,
        acceptedRecommendationIds,
        dismissedRecommendationIds,
      });
    } finally {
      setFinalising(false);
    }
  }, [acceptedIds, onFinalise, recommendationIds]);

  const hasRecommendations = recommendations.length > 0;
  const acceptedCount = acceptedIds.size;

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
        maxWidth: 960,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {subtitle || `${reviewerName} reviewed ${primaryAuthorName}'s output and returned recommendations only.`}
              {hasRecommendations
                ? ` ${recommendations.length} recommendation${recommendations.length !== 1 ? 's' : ''} found.`
                : ' No recommendations found.'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>×</button>
        </div>

        {notes && (
          <div style={{ padding: '10px 24px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
            💡 {notes}
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, padding: 24 }}>
          {!hasRecommendations && (
            <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 600 }}>{reviewerName} found no recommendations.</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>You can keep the original output.</div>
            </div>
          )}

          {hasRecommendations && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recommendations.map((rec, idx) => {
                const id = rec.id || `recommendation-${idx}`;
                const accepted = acceptedIds.has(id);
                return (
                  <div key={id} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 42px',
                    gap: 10,
                    alignItems: 'start',
                    padding: 12,
                    borderRadius: 10,
                    border: `1px solid ${accepted ? '#86efac' : '#e5e7eb'}`,
                    background: accepted ? '#f0fdf4' : '#fafafa',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                        Current output
                      </div>
                      {rec.target?.label && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>{rec.target.label}</div>
                      )}
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {displayText(rec.original)}
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                        Recommendation
                      </div>
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        <mark style={{ background: '#d1fae5', padding: '1px 3px', borderRadius: 3 }}>
                          {displayText(rec.recommended)}
                        </mark>
                      </div>
                      {rec.reason && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>{rec.reason}</div>
                      )}
                      {rec.evidence && (
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Evidence: {rec.evidence}</div>
                      )}
                      {rec.severity && (
                        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {rec.type || 'recommendation'} · {rec.severity}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => toggleRecommendation(id)}
                      title={accepted ? 'Dismiss recommendation' : 'Accept recommendation'}
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
                      }}
                    >✓</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
            {acceptedCount} recommendation{acceptedCount !== 1 ? 's' : ''} accepted
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => emitDecision('use_original')}
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
              Use {primaryAuthorName} only
            </button>
            <button
              onClick={() => emitDecision('apply')}
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
              {finalising ? 'Applying…' : 'Apply accepted'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
