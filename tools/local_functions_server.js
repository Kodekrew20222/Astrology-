import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import geminiHandler from '../netlify/functions/gemini.js'

const DEFAULT_PORT = 8787
const HOST = process.env.LOCAL_FUNCTIONS_HOST || '127.0.0.1'
const PORT = Number(process.env.LOCAL_FUNCTIONS_PORT || DEFAULT_PORT)

function loadEnvFile(filePath) {
  let content = ''

  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  content.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return
    }

    const separatorIndex = trimmedLine.indexOf('=')
    if (separatorIndex < 0) {
      return
    }

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  })
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

async function readRequestBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

async function writeFetchResponse(nodeResponse, fetchResponse) {
  nodeResponse.writeHead(
    fetchResponse.status,
    Object.fromEntries(fetchResponse.headers.entries()),
  )

  if (!fetchResponse.body) {
    nodeResponse.end()
    return
  }

  const reader = fetchResponse.body.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    nodeResponse.write(Buffer.from(value))
  }

  nodeResponse.end()
}

async function writeMockGeminiStream(response) {
  const chunks = [
    'Namaste. Let us test this voice with a longer, more varied reading. ',
    'Today the moon moves through a quiet emotional house, so the first message is simple: pause, breathe, and notice what your body already knows. ',
    'Mercury brings quick thoughts, bright questions, and a few tangled conversations, but you do not need to answer everything at once. ',
    'There are soft sounds here, like moon, me, memory, and movement. There are sharper sounds too: path, purpose, pressure, promise, karma, courage, clarity, and change. ',
    'Aapke andar ek shant sa sanket hai. Dhyan se suno, phir dheere se bolo: main taiyaar hoon, main seekh raha hoon, aur main apni roshni ko chhupaunga nahi. ',
    'If something feels delayed, it may be asking for better timing rather than more force. If something feels intense, it may be asking for honesty rather than fear. ',
    'Saturn says build slowly. Venus says soften your voice. Mars says move your feet. Jupiter says do not make your world smaller just to make other people comfortable. ',
    'So this is the reading: speak clearly, choose carefully, rest fully, and let the next step arrive with steadiness. ',
    'Now we add a final rhythm check: ah, ee, oo, oh, pa, ba, ma, fa, va, ta, da, ka, ga, sha, ra, la. The mouth should open, close, narrow, round, and rest with the audio.',
  ]

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  })

  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: chunk }],
          },
        },
      ],
    })}\n\n`)

    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 180)
    })
  }

  response.end()
}

loadEnvFile(resolve(process.cwd(), '.env'))

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`)

    if (url.pathname === '/health') {
      sendJson(response, 200, {
        geminiApiKeyLoaded: Boolean(process.env.GEMINI_API_KEY),
        mockMode: process.env.LOCAL_GEMINI_MOCK === 'true',
        ready: true,
      })
      return
    }

    if (url.pathname !== '/.netlify/functions/gemini') {
      sendJson(response, 404, { error: 'Local function not found' })
      return
    }

    if (process.env.LOCAL_GEMINI_MOCK === 'true') {
      await writeMockGeminiStream(response)
      return
    }

    const body = await readRequestBody(request)
    const headers = new Headers()

    Object.entries(request.headers).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        headers.set(key, value.join(', '))
        return
      }

      if (value !== undefined) {
        headers.set(key, value)
      }
    })

    const fetchRequest = new Request(url, {
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
      headers,
      method: request.method,
    })

    const fetchResponse = await geminiHandler(fetchRequest)
    await writeFetchResponse(response, fetchResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(response, 500, { error: message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Local functions server listening at http://${HOST}:${PORT}`)
  console.log('Proxy target: /.netlify/functions/gemini')
})
