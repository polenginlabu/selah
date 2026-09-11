// SSE -> NDJSON translation, kept out of index.ts so it can be tested without
// booting the server or reading the environment.
/**
 * Translates an upstream OpenAI-style SSE stream into the NDJSON frames the
 * client expects.
 *
 * Exported for testing: the buffering here is the classic place this goes
 * wrong. A network chunk boundary lands mid-line often, so the trailing
 * partial line must be carried into the next read rather than parsed.
 */
export function translateStream(
  body: ReadableStream<Uint8Array>,
  conversationId: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      const reader = body.getReader()
      let buffer = ''
      let sawContent = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              const delta = parsed?.choices?.[0]?.delta?.content
              if (typeof delta === 'string' && delta) {
                sawContent = true
                send({ type: 'text', content: delta })
              }
            } catch {
              // A torn frame is not worth killing the answer over.
            }
          }
        }

        if (!sawContent) {
          send({ type: 'error', error: 'The assistant returned an empty reply.' })
        } else {
          send({ type: 'done', conversationId })
        }
      } catch (err) {
        console.error('bible-chat: stream failed', err)
        send({ type: 'error', error: 'The reply was cut short.' })
      } finally {
        try {
          await reader.cancel()
        } catch {
          // already closed
        }
        controller.close()
      }
    },
  })
}
