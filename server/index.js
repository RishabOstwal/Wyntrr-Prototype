import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const here = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(here, '../dist');

app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    tavusConfigured: Boolean(process.env.TAVUS_API_KEY),
    palConfigured: Boolean(process.env.TAVUS_PAL_ID),
  });
});

app.post('/api/conversations', async (req, res) => {
  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Add TAVUS_API_KEY to the server environment to connect Tavus.' });
  }

  const { pal_id, face_id, conversation_name, conversational_context, custom_greeting, audio_only } = req.body ?? {};
  const configuredPalId = process.env.TAVUS_PAL_ID;
  const selectedPalId = typeof pal_id === 'string' && pal_id.trim() ? pal_id.trim() : configuredPalId;
  if (!selectedPalId) {
    return res.status(503).json({ error: 'Set TAVUS_PAL_ID in the server .env file to start calls.' });
  }

  const body = {
    pal_id: selectedPalId,
    audio_only: audio_only === true,
    ...(typeof face_id === 'string' && face_id.trim() ? { face_id: face_id.trim() } : process.env.TAVUS_FACE_ID ? { face_id: process.env.TAVUS_FACE_ID.trim() } : {}),
    ...(typeof conversation_name === 'string' && conversation_name.trim() ? { conversation_name: conversation_name.trim() } : {}),
    ...(typeof conversational_context === 'string' && conversational_context.trim() ? { conversational_context: conversational_context.trim() } : {}),
    ...(typeof custom_greeting === 'string' && custom_greeting.trim() ? { custom_greeting: custom_greeting.trim() } : {}),
  };

  try {
    const upstream = await fetch('https://tavusapi.com/v2/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const responseText = await upstream.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { error: responseText || 'Tavus returned an unreadable response.' };
    }
    return res.status(upstream.status).json(payload);
  } catch {
    return res.status(502).json({ error: 'Could not reach the Tavus API. Check the server network and try again.' });
  }
});

app.post('/api/conversations/:conversationId/end', async (req, res) => {
  const apiKey = process.env.TAVUS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Add TAVUS_API_KEY to the server environment to connect Tavus.' });
  }

  const { conversationId } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
    return res.status(400).json({ error: 'Invalid conversation ID.' });
  }

  try {
    const upstream = await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(conversationId)}/end`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
    });
    const responseText = await upstream.text();
    if (!upstream.ok) {
      let payload;
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { error: responseText || 'Tavus could not end this conversation.' };
      }
      return res.status(upstream.status).json(payload);
    }
    return res.json({ ended: true });
  } catch {
    return res.status(502).json({ error: 'Could not reach the Tavus API. Check the server network and try again.' });
  }
});

app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  return res.sendFile(path.join(distPath, 'index.html'), (error) => error && next());
});

app.listen(port, () => {
  console.log(`Tavus Studio server listening on http://localhost:${port}`);
});
