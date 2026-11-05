import { createLemonSliceSession, isLemonSliceConfigured } from './lemonslice.js';

export function getHealth(_req, res) {
  res.json({
    tavusConfigured: Boolean(process.env.TAVUS_API_KEY?.trim()),
    palConfigured: Boolean(process.env.TAVUS_PAL_ID?.trim()),
    lilSparkConfigured: isLemonSliceConfigured(),
  });
}

function getTavusTranscriptionEvent(conversation) {
  const events = Array.isArray(conversation?.events) ? conversation.events : [];
  return events.find((event) => (event?.event_type ?? event?.eventType ?? event?.type ?? event?.name) === 'application.transcription_ready') ?? null;
}

function getTavusMessages(conversation) {
  const event = getTavusTranscriptionEvent(conversation);
  const properties = event?.properties ?? {};
  const transcript = Array.isArray(properties.transcript) ? properties.transcript : [];
  return transcript.flatMap((entry) => {
    const sourceRole = entry?.role;
    const role = sourceRole === 'replica' ? 'assistant' : sourceRole;
    const text = typeof entry?.content === 'string' ? entry.content : entry?.text;
    const offsetSeconds = Number(entry?.seconds_from_start);
    if (!['user', 'assistant'].includes(role) || typeof text !== 'string' || !Number.isFinite(offsetSeconds)) return [];

    const metadata = entry?.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? { ...entry.metadata }
      : {};
    const language = entry?.language ?? metadata.language ?? properties.language;
    if (typeof language === 'string' && language.trim()) metadata.language = language;

    return [{
      role,
      text,
      offsetSeconds,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    }];
  });
}

export async function getConversation(req, res) {
  const apiKey = process.env.TAVUS_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Calls are not configured on the server. Contact the site administrator.' });
  }

  const conversationId = req.params?.conversationId;
  if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
    return res.status(400).json({ error: 'Invalid conversation ID.' });
  }

  try {
    let payload = {};
    let upstreamStatus = 200;
    for (let attempt = 0; attempt < 10; attempt++) {
      const upstream = await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(conversationId)}?verbose=true`, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      });
      const responseText = await upstream.text();
      upstreamStatus = upstream.status;
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = { error: responseText || 'The call service returned an unreadable response.' };
      }
      if (!upstream.ok) return res.status(upstream.status).json(payload);
      if (getTavusTranscriptionEvent(payload) || attempt === 9) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const transcriptReady = Boolean(getTavusTranscriptionEvent(payload));
    return res.status(upstreamStatus).json({ conversation: payload, transcriptReady, messages: getTavusMessages(payload) });
  } catch {
    return res.status(502).json({ error: 'Could not reach the call service. Check the server connection and try again.' });
  }
}

export async function createConversation(req, res) {
  const { pal_id, partner, face_id, conversation_name, conversational_context, custom_greeting, audio_only } = req.body ?? {};
  if (partner !== undefined && partner !== 'wyntrr' && partner !== 'lil-spark') {
    return res.status(400).json({ error: 'Invalid chat partner.' });
  }
  if (partner === 'lil-spark') return createLemonSliceSession(req, res);

  const apiKey = process.env.TAVUS_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Calls are not configured on the server. Contact the site administrator.' });
  }

  const configuredPalId = process.env.TAVUS_PAL_ID?.trim();
  const selectedPalId = typeof pal_id === 'string' && pal_id.trim() ? pal_id.trim() : configuredPalId;
  if (!selectedPalId) {
    return res.status(503).json({ error: 'Calls are not configured on the server. Contact the site administrator.' });
  }

  const configuredFaceId = process.env.TAVUS_FACE_ID?.trim();
  const body = {
    pal_id: selectedPalId,
    audio_only: audio_only === true,
    properties: { enable_closed_captions: true },
    ...(typeof face_id === 'string' && face_id.trim() ? { face_id: face_id.trim() } : configuredFaceId ? { face_id: configuredFaceId } : {}),
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
      payload = { error: responseText || 'The call service returned an unreadable response.' };
    }
    return res.status(upstream.status).json(payload);
  } catch {
    return res.status(502).json({ error: 'Could not reach the call service. Check the server connection and try again.' });
  }
}

export async function endConversation(req, res) {
  const apiKey = process.env.TAVUS_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'Calls are not configured on the server. Contact the site administrator.' });
  }

  const conversationId = req.params?.conversationId ?? req.query?.conversationId;
  if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
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
        payload = { error: responseText || 'The call service could not end this conversation.' };
      }
      return res.status(upstream.status).json(payload);
    }
    return res.json({ ended: true });
  } catch {
    return res.status(502).json({ error: 'Could not reach the call service. Check the server connection and try again.' });
  }
}
