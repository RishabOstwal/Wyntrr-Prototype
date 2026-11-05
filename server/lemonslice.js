export const isLemonSliceConfigured = () => Boolean(process.env.LEMONSLICE_API_KEY?.trim() && process.env.LEMONSLICE_AGENT_ID?.trim());

// Creates a hosted LemonSlice session. LemonSlice provisions a Daily room and token for the browser to join.
export async function createLemonSliceSession(_req, res) {
  const apiKey = process.env.LEMONSLICE_API_KEY?.trim();
  const agentId = process.env.LEMONSLICE_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    return res.status(503).json({ error: 'Calls are not configured on the server. Contact the site administrator.' });
  }

  try {
    const upstream = await fetch('https://lemonslice.com/api/liveai/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ agent_id: agentId }),
    });
    const responseText = await upstream.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = { detail: responseText.trim() };
    }
    if (!upstream.ok) {
      const upstreamMessage = [
        payload?.detail,
        payload?.message,
        payload?.error_description,
        typeof payload?.error === 'string' ? payload.error : payload?.error?.message,
      ].find((message) => typeof message === 'string' && message.trim());
      const error = upstreamMessage || (upstream.status === 401 || upstream.status === 403
        ? `LemonSlice rejected the API credentials (${upstream.status}). Check the API key and agent access.`
        : 'Could not start the call.');
      return res.status(upstream.status).json({ error });
    }
    if (!payload.room_url || !payload.session_id) {
      return res.status(502).json({ error: 'The call service response was missing a connection URL.' });
    }
    return res.status(201).json({
      provider: 'lemonslice',
      conversation_id: payload.session_id,
      conversation_url: payload.room_url,
      token: payload.token,
    });
  } catch {
    return res.status(502).json({ error: 'Could not reach the call service. Check the server connection and try again.' });
  }
}
