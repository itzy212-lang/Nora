// src/utils/useMyPlan.js
//
// The signed-in user's plan in plain words (api/my-plan.js), for the left-hand menu. Returns null until it
// loads, or if it cannot be loaded (the menu then simply shows nothing). Refreshes when 'ely:plan-changed' fires.
import { useEffect, useState } from 'react';
import sb from '../supabaseClient';

export default function useMyPlan() {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch('/api/my-plan', { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setPlan(json);
      } catch { /* the plan label is a convenience; never break the menu */ }
    };
    load();
    window.addEventListener('ely:plan-changed', load);
    return () => { alive = false; window.removeEventListener('ely:plan-changed', load); };
  }, []);
  return plan;
}
