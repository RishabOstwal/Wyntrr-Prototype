import { createVideoSessionLog } from '../../server/video-sessions.js';

export default function videoSessionLog(req, res) {
  const catchAllPath = req.query?.path;
  const segments = Array.isArray(catchAllPath)
    ? catchAllPath
    : typeof catchAllPath === 'string'
      ? catchAllPath.split('/')
      : new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).slice(-3);
  const videoSessionId = segments[0] === 'sessions' && segments[2] === 'logs' ? segments[1] : undefined;
  req.params = { ...req.params, videoSessionId };
  return createVideoSessionLog(req, res);
}
