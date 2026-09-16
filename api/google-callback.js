export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ 
      status: 'test',
      message: 'Callback endpoint is working',
      env: {
        hasClientId: !!process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
        hasSecret: !!process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        hasUrl: !!process.env.SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      query: req.query,
      method: req.method,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
