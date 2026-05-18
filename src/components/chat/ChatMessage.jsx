import { renderMarkdown } from '../../utils/formatters';
import DraftCard from './DraftCard';

export default function ChatMessage({ msg, onUseDraft, onOpenInComposer }) {
  const isUser = msg.role === 'user';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`chat-msg ${isUser ? 'user' : 'ely'}`}>
        {isUser ? (
          msg.content
        ) : (
          <div
            className="ely-md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        )}
      </div>
      {!isUser && msg.draft && (
        <DraftCard
          draft={msg.draft}
          draftType={msg.draftType}
          onUseDraft={onUseDraft}
          onOpenInComposer={onOpenInComposer}
        />
      )}
      {msg.suggestedActions?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {msg.suggestedActions.map((a, i) => (
            <span key={i} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 99, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--bg4)', color: 'var(--text2)',
              transition: 'all 0.15s',
            }}>
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
