# Wyntrr Prototype

A minimal video calling frontend integrated with Tavus. Start a video call from the home screen; the app joins directly in its custom call view.

## Setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Add your Tavus API key and PAL ID to `.env`:

   ```env
   TAVUS_API_KEY=your_tavus_api_key
   TAVUS_PAL_ID=your_tavus_pal_id
   # Optional: enable Lil Spark (powered by LemonSlice).
   LEMONSLICE_API_KEY=your_lemonslice_api_key
   LEMONSLICE_AGENT_ID=your_lemonslice_agent_id
   PORT=3002
   LOGIN_API_URL=http://192.168.11.160:3001/video-login
   VIDEO_SESSIONS_API_URL=http://192.168.11.160:3001/video/sessions
   ```

4. Install dependencies with `npm install`.
5. Start the app with `npm run dev`, then open the Vite URL printed in the terminal.

The Express server keeps the API key and PAL ID on the server and proxies conversation creation and ending to Tavus. The browser loads Daily's call SDK to connect media, but the call UI is rendered by this app.

The partner picker includes Wyntrr (Tavus) and Lil Spark (LemonSlice). Lil Spark sessions are created on the server through LemonSlice's hosted session API, which returns a Daily room URL and token that the same custom call view joins. Set `LEMONSLICE_API_KEY` and `LEMONSLICE_AGENT_ID` to enable it. Captions and camera-state updates are Tavus-specific and do not apply to Lil Spark calls.

Starting a call stays in the browser tab without requesting fullscreen. The start button keeps its "Start video call" label while loading; "Connecting..." appears only on the next, in-call screen. Connection errors remain visible.

During a call, scrollable captions sit below the video and above the controls without covering the stream. The video aligns just above visible captions without cropping, keeping letterboxing above rather than between the video and captions. Turning captions off returns that space to the video. Your camera preview can be dragged within the video area.

## Access from another computer on your LAN

Camera and microphone access requires a secure browser context. `http://localhost:5173` works on the development computer, but a LAN address such as `http://192.168.11.177:5173` needs HTTPS.

On the development computer, install [mkcert](https://github.com/FiloSottile/mkcert) (for example, with Chocolatey: `choco install mkcert`), then run these PowerShell commands from the project folder. Replace the example address with the development computer's current LAN IPv4 address from `ipconfig`:

```powershell
mkcert -install
New-Item -ItemType Directory -Force certs
mkcert -cert-file certs/lan.pem -key-file certs/lan-key.pem 192.168.11.177 localhost 127.0.0.1
```

Restart `npm run dev`. Vite will detect the certificate files and serve HTTPS. Open `https://192.168.11.177:5173` on the other computer.

For the browser on the other computer to trust the certificate, install the mkcert root certificate from the development computer. Run `mkcert -CAROOT` there and copy only `rootCA.pem` to the other computer. On Windows, open `rootCA.pem`, choose **Install Certificate**, select **Current User**, then place it in **Trusted Root Certification Authorities**. Restart the browser after installation. Never copy `rootCA-key.pem`. The `certs/` folder is ignored by Git.

## Production

Run `npm run build`, then run `npm start` with `TAVUS_API_KEY` and `TAVUS_PAL_ID` set in the server environment.

For Vercel, the API routes in `api/` are deployed alongside the Vite frontend. Add `TAVUS_API_KEY` and `TAVUS_PAL_ID` under the project's **Settings → Environment Variables** for the Production environment, then redeploy.
