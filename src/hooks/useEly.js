import { useState, useCallback } from 'react';
import { callEly } from '../api/elyRouter';
import { useApp } from '../state/appStore';

export function useEly({ surface = 'main_chat', projectId = null } = {}) {
  const { state } = useApp();
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const send = useCallback(async (prompt, extraOpts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await callEly({
        prompt,
        surface,
        sessionId,
        projectId: projectId || extraOpts.projectId || null,
        userId: state.currentUser?.id || state.currentUser?.email || null,
        ...extraOpts,
      });
      if (result.sessionId) setSessionId(result.sessionId);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [surface, sessionId, projectId, state.currentUser]);

  const resetSession = useCallback(() => {
    setSessionId(null);
  }, []);

  return { send, loading, error, sessionId, resetSession };
}
