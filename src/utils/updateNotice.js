// Added 2026-10-26. The installed app on a phone stays open in memory for days,
// so a fix that was deployed minutes ago keeps running the OLD code until the
// app is fully closed. This checks (when the app comes back to the screen, and
// every 10 minutes) whether a newer build exists and, if so, shows a bar the
// user can tap to reload. Nothing is reloaded automatically, so no drafts are lost.
const currentScript = () => [...document.scripts].map(s => s.src).find(src => /\/assets\/.+\.js/.test(src)) || null;

async function latestScript() {
  const res = await fetch('/index.html?cb=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) return null;
  const m = (await res.text()).match(/\/assets\/[^"']+\.js/);
  return m ? new URL(m[0], location.origin).href : null;
}

function showBar() {
  if (document.getElementById('nora-update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'nora-update-bar';
  bar.textContent = 'A new version of Nora is ready — tap here to update';
  Object.assign(bar.style, {
    position: 'fixed', left: '12px', right: '12px', bottom: '12px', zIndex: 2147483000,
    background: '#0a0a0a', color: '#fff', padding: '12px 14px', borderRadius: '12px',
    fontSize: '14px', fontWeight: '600', textAlign: 'center', cursor: 'pointer',
    boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
  });
  bar.addEventListener('click', () => location.reload());
  document.body.appendChild(bar);
}

export function initUpdateNotice() {
  try {
    const mine = currentScript();
    if (!mine) return; // dev server or unusual build: nothing to compare
    const check = async () => {
      try {
        const latest = await latestScript();
        if (latest && latest !== mine) showBar();
      } catch { /* offline - try again later */ }
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 10 * 60 * 1000);
    setTimeout(check, 15000);
  } catch { /* never let this break the app */ }
}
