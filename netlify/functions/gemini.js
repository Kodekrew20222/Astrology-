const GEMINI_API_VERSION = 'v1beta'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite'

function getEnv(name) {
  if (globalThis.Netlify?.env?.get) {
    return globalThis.Netlify.env.get(name)
  }

  return process.env[name]
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  })
}

function normalizeContents(contents) {
  if (!Array.isArray(contents)) {
    return []
  }

  return contents
    .map((content) => {
      const role = content?.role === 'model' ? 'model' : 'user'
      const text = content?.parts
        ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('')
        .trim()

      if (!text) {
        return null
      }

      return {
        role,
        parts: [{ text }],
      }
    })
    .filter(Boolean)
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON' })
  }

  const apiKey = getEnv('GEMINI_API_KEY')
  if (!apiKey) {
    return jsonResponse(500, { error: 'Missing GEMINI_API_KEY' })
  }

  const contents = normalizeContents(body.contents)
  if (contents.length === 0) {
    return jsonResponse(400, { error: 'At least one chat message is required' })
  }

  const model = getEnv('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL
  const upstreamUrl = new URL(
    `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${model}:streamGenerateContent`,
  )
  upstreamUrl.searchParams.set('alt', 'sse')

  const upstreamResponse = await fetch(upstreamUrl, {
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: 700,
        temperature: 0.8,
      },
      systemInstruction: {
        parts: [
          {
            text:
              'You are a concise astrology guide. Give helpful, grounded readings and avoid medical, legal, or financial certainty.',
          },
        ],
      },
    }),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    method: 'POST',
  })

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const errorText = await upstreamResponse.text()
    return jsonResponse(upstreamResponse.status || 502, {
      error: errorText || 'Gemini stream failed',
    })
  }

  return new Response(upstreamResponse.body, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
    status: 200,
  })
}
