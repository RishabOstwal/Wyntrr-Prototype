const DEFAULT_VIDEO_SESSIONS_API_URL = 'http://192.168.11.160:3001/video/sessions';

export async function createVideoSession(req, res) {
  const { provider, providerSessionId, conversationId, metadata } = req.body ?? {};
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!['lemonslice', 'tavus'].includes(provider)
    || typeof providerSessionId !== 'string' || !providerSessionId.trim()
    || typeof conversationId !== 'string' || !conversationId.trim()) {
    return res.status(400).json({ error: 'A provider, provider session ID, and login conversation ID are required.' });
  }

  const requestBody = {
    provider,
    providerSessionId: providerSessionId.trim(),
    conversationId: conversationId.trim(),
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : { source: 'web' },
  };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiUrl = process.env.VIDEO_SESSIONS_API_URL || DEFAULT_VIDEO_SESSIONS_API_URL;
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(10000),
    });
    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = responseText.slice(0, 4000);
    }
    if (!contentType.includes('application/json')) {
      return res.status(response.ok ? 502 : response.status).json({
        error: response.ok ? 'The session service returned an unexpected response.' : 'Could not save the video session.',
      });
    }

    if (!response.ok || payload?.success === false || payload?.ok === false) {
      return res.status(response.ok ? 502 : response.status).json({
        error: payload?.message || payload?.error || 'Could not save the video session.',
      });
    }
    return res.status(response.status).json(payload);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'The session service took too long to respond.' : 'Could not reach the session service.',
    });
  }
}

export async function createVideoSessionLog(req, res) {
  const videoSessionId = req.params?.videoSessionId;
  const { providerSessionId, status, expectedRevision, durationSeconds, cost, endReason, messages, metadata } = req.body ?? {};
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (typeof videoSessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(videoSessionId)
    || typeof providerSessionId !== 'string' || !providerSessionId.trim()
    || status !== 'completed'
    || !Number.isInteger(expectedRevision) || expectedRevision < 0
    || !Number.isFinite(durationSeconds) || durationSeconds < 0
    || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'The completed call log is missing required fields.' });
  }

  const requestBody = {
    providerSessionId: providerSessionId.trim(),
    status,
    expectedRevision,
    durationSeconds,
    ...(Number.isFinite(cost) ? { cost } : {}),
    ...(typeof endReason === 'string' && endReason.trim() ? { endReason: endReason.trim() } : {}),
    messages,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : { source: 'web' },
  };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiUrl = `${(process.env.VIDEO_SESSIONS_API_URL || DEFAULT_VIDEO_SESSIONS_API_URL).replace(/\/+$/, '')}/${encodeURIComponent(videoSessionId)}/logs`;
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000),
    });
    const responseText = await response.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { error: responseText.slice(0, 4000) || 'The session service returned an unreadable response.' };
    }
    if (!response.ok || payload?.success === false || payload?.ok === false) {
      return res.status(response.ok ? 502 : response.status).json({
        error: payload?.message || payload?.error || 'Could not save the completed call log.',
        response: payload,
      });
    }
    return res.status(response.status).json(payload);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'The log service took too long to respond.' : 'Could not reach the log service.',
    });
  }
}
