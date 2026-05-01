# Local Madhur Voice

The app can call a local voice bridge at `http://127.0.0.1:8020/speak`.

It defaults to the Hindi India male voice from your screenshot:

```text
hi-IN-MadhurNeural
```

This uses `edge-tts`, which is free and lightweight, but it does need internet access when generating speech.

## Setup

```bash
npm run voice:venv
npm run voice:install
npm run voice
```

Then run the app and turn on "Madhur voice".

Long local test readings are allowed up to `VOICE_MAX_TEXT_CHARS`, which defaults to `6000`.

## Quick Test

```bash
curl -X POST http://127.0.0.1:8020/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"Namaste, main Madhur voice mein bol raha hoon.","voice":"hi-IN-MadhurNeural"}' \
  --output /tmp/madhur-test.mp3
```

You can also try:

- `hi-IN-SwaraNeural`
- `en-IN-PrabhatNeural`
- `en-IN-NeerjaNeural`
