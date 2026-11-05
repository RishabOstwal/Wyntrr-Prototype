import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const certificatePath = new URL('./certs/lan.pem', import.meta.url);
const certificateKeyPath = new URL('./certs/lan-key.pem', import.meta.url);
const hasCertificate = existsSync(certificatePath);
const hasCertificateKey = existsSync(certificateKeyPath);

if (hasCertificate !== hasCertificateKey) {
  throw new Error('LAN HTTPS needs both certs/lan.pem and certs/lan-key.pem.');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.PORT || env.PORT || '3002';
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      ...(hasCertificate ? {
        https: {
          cert: readFileSync(certificatePath),
          key: readFileSync(certificateKeyPath),
        },
      } : {}),
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  };
});
