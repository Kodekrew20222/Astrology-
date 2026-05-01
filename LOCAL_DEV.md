# Local Dev

Use the fully local dev stack for everyday work. It runs Vite plus a tiny local Node server that reuses the same Gemini function handler Netlify uses in production.

```bash
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The local function server runs at:

```text
http://127.0.0.1:8787
```

Vite proxies `/.netlify/functions/gemini` to that local server. Netlify is not involved while you test locally.

To test the UI without calling Gemini either, set this in `.env`:

```text
LOCAL_GEMINI_MOCK=true
```

Mock mode streams a canned response through the same browser path, so the chat, lipsync, and voice flow can be tested without any cloud usage.

Netlify Dev is still available when you specifically want to test Netlify's local runtime:

```bash
npm run dev:netlify
```

For Madhur voice, keep the voice bridge running in another terminal:

```bash
npm run voice
```
