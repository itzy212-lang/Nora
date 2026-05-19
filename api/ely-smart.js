// api/ely-smart.js
// Replaces the old /api/ely-ai proxy — calls Anthropic directly with full context

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const {
    prompt,
    surface = 'main_chat',
    chatHistory = [],
    projectsContext = [],
    currentProject = null,
    recentEmails = [],
    emailContext = null,
    userId,
  } = req.body;

  if (!prompt && !emailContext) return res.status(400).json({ error: 'No prompt provided' });

  try {
    const systemPrompt = buildSystemPrompt({ surface, projectsContext, currentProject, recentEmails });
    const messages = buildMessages({ chatHistory, prompt, emailContext, surface });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Anthropic error ${response.status}`);
    }

    const data = await response.json();
    const replyText = data.content?.find(b => b.type === 'text')?.text || '';

    return res.status(200).json({
      reply: replyText,
      replyText,
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

  } catch (err) {
    console.error('ely-smart error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt({ surface, projectsContext, currentProject, recentEmails }) {
  const base = `You are Ely, an expert AI assistant for a UK party wall surveyor practice. You have deep knowledge of the Party Wall etc. Act 1996, UK building regulations, and party wall surveying practice. You are professional, precise, and helpful.

Key rules:
- Always apply the Party Wall etc. Act 1996 correctly
- Use proper legal terminology for notices, awards, and appointments
- When drafting documents, use professional formal language
- Statutory timescales: S1/S6 = 1 month notice, S3 = 2 months notice, S10 = 10 days for surveyor appointment, 14 days consent period
- When asked to draft something, produce the full draft without asking unnecessary clarifying questions`;

  let context = '';

  // Add projects context
  if (projectsContext.length > 0) {
    context += `\n\n=== ACTIVE PROJECTS ===\n`;
    projectsContext.forEach(p => {
      context += `\n• ${p.ref} — ${p.address}`;
      if (p.status) context += ` [${p.status}]`;
      if (p.role) context += ` | Acting as: ${p.role === 'AO' ? 'Adjoining Owner Surveyor' : 'Building Owner Surveyor'}`;
      if (p.boName) context += ` | BO: ${p.boName}`;
      if (p.aoCount) context += ` | ${p.aoCount} AO(s)`;
      if (p.nextAction) context += ` | Next: ${p.nextAction}`;
    });
  } else {
    context += '\n\nNo active projects loaded yet.';
  }

  // Add current project detail if in project chat
  if (currentProject) {
    context += `\n\n=== CURRENT PROJECT (FULL DETAIL) ===`;
    context += `\nReference: ${currentProject.ref}`;
    context += `\nAddress: ${currentProject.address}`;
    context += `\nStatus: ${currentProject.status || 'Active'}`;
    context += `\nRole: ${currentProject.role === 'AO' ? 'Adjoining Owner Surveyor' : 'Building Owner Surveyor'}`;
    if (currentProject.bo_name) context += `\nBuilding Owner: ${currentProject.bo_name}`;
    if (currentProject.bo_email) context += `\nBO Email: ${currentProject.bo_email}`;
    if (currentProject.works) context += `\nWorks: ${currentProject.works}`;
    if (currentProject.aos?.length > 0) {
      context += `\nAdjoining Owners:`;
      currentProject.aos.forEach((ao, i) => {
        context += `\n  AO${i + 1}: ${ao.name || 'Unknown'} — ${ao.premise || ao.address || 'Address unknown'}`;
        if (ao.status) context += ` [${ao.status}]`;
        if (ao.consent_deadline) context += ` | Consent deadline: ${ao.consent_deadline}`;
      });
    }
  }

  // Add recent emails context
  if (recentEmails.length > 0) {
    context += `\n\n=== RECENT EMAILS (last ${recentEmails.length}) ===\n`;
    recentEmails.slice(0, 5).forEach(e => {
      context += `\n• From: ${e.from || 'Unknown'} | Subject: ${e.subject || '(no subject)'} | ${e.date || ''}`;
      if (e.preview) context += `\n  Preview: ${e.preview.slice(0, 200)}`;
    });
  }

  // Surface-specific instructions
  const surfaceInstructions = {
    main_chat: `\n\nYou are the main practice assistant. Answer questions, help with party wall law, draft documents, and assist with project management. You have full context of all projects listed above.`,
    project_chat: `\n\nYou are assisting with the specific project shown above. Focus all responses on this project. You know all the AO details, notice dates, and project status. Be specific and actionable.`,
    email_composer: `\n\nYou are helping draft a professional email reply. Be concise, professional, and match the tone of a party wall surveyor's correspondence. Produce a ready-to-send draft.`,
    soc: `\n\nYou are processing site dictation notes to produce a Schedule of Condition. Format the output as:\n1. A table with Location | Description | Condition (Good/Fair/Poor)\n2. Email to Building Owner (if any BO notes flagged)\n3. Email to Architect (if any technical notes flagged)\nUse professional surveying language throughout.`,
  };

  return base + context + (surfaceInstructions[surface] || surfaceInstructions.main_chat);
}

function buildMessages({ chatHistory, prompt, emailContext, surface }) {
  const messages = [];

  // Include prior conversation (last 10 turns)
  const history = (chatHistory || []).slice(-20);
  history.forEach(msg => {
    messages.push({
      role: msg.role === 'ely' ? 'assistant' : 'user',
      content: msg.content,
    });
  });

  // Build the user message
  let userContent = prompt || '';
  if (emailContext && surface === 'email_composer') {
    userContent = `Email context:\nFrom: ${emailContext.from}\nSubject: ${emailContext.subject}\n\nEmail body:\n${emailContext.body}\n\n${prompt ? `My instructions: ${prompt}` : 'Please summarise this email and suggest a professional reply.'}`;
  }

  if (userContent) {
    messages.push({ role: 'user', content: userContent });
  }

  return messages;
}
