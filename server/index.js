import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { login } from './login.js';
import { createVideoSession, createVideoSessionLog } from './video-sessions.js';
import { createConversation, endConversation, getConversation, getHealth } from './tavus.js';

const app = express();
const port = Number(process.env.PORT || 3002);
const here = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(here, '../dist');

app.use(express.json({ limit: '64kb' }));

app.get('/api/health', getHealth);
app.post('/api/auth/login', login);
app.post('/api/video/sessions', createVideoSession);
app.post('/api/video/sessions/:videoSessionId/logs', createVideoSessionLog);
app.get('/api/conversations/:conversationId', getConversation);
app.post('/api/conversations', createConversation);
app.post('/api/conversations/:conversationId/end', endConversation);

app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  return res.sendFile(path.join(distPath, 'index.html'), (error) => error && next());
});

app.listen(port, () => {
  console.log(`Tavus Studio server listening on http://localhost:${port}`);
});
