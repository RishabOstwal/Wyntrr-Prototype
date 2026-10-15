# Wyntrr Prototype

A minimal video calling frontend integrated with Tavus. Start a video call from the home screen; the app joins directly in its custom call view.

## Setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Add your Tavus API key and PAL ID to `.env`:

   ```env
   TAVUS_API_KEY=your_tavus_api_key
   TAVUS_PAL_ID=your_tavus_pal_id
   PORT=3001
   ```

4. Install dependencies with `npm install`.
5. Start the app with `npm run dev`, then open the Vite URL printed in the terminal.

The Express server keeps the API key and PAL ID on the server and proxies conversation creation and ending to Tavus. The browser loads Daily's call SDK to connect media, but the call UI is rendered by this app.

## Production

Run `npm run build`, then run `npm start` with `TAVUS_API_KEY` and `TAVUS_PAL_ID` set in the server environment.

For Vercel, the API routes in `api/` are deployed alongside the Vite frontend. Add `TAVUS_API_KEY` and `TAVUS_PAL_ID` under the project's **Settings → Environment Variables** for the Production environment, then redeploy.
