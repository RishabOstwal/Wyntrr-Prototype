const DEFAULT_LOGIN_API_URL = 'http://192.168.11.160:3001/video-login';

export async function login(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  const loginApiUrl = process.env.LOGIN_API_URL || DEFAULT_LOGIN_API_URL;
  try {
    const response = await fetch(loginApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return res.status(response.ok ? 502 : response.status).json({
        error: response.ok ? 'The sign-in service returned an unexpected response.' : 'Email or password is incorrect.',
      });
    }

    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.message || payload?.error || (response.status === 401 || response.status === 403 ? 'Email or password is incorrect.' : 'Could not sign in. Please try again.'),
      });
    }
    return res.status(response.status).json(payload);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'The sign-in service took too long to respond.' : 'Could not reach the sign-in service. Check that it is running and try again.',
    });
  }
}
