import { useEffect } from 'react'

const SCRIPT_SRC = 'https://www.zackion-ai.com/chatbot.js'
const BOT_KEY = 'zz_bot-6a00423c-7659-4bb3-b068-5e9e381a33a1'

/**
 * Loads the Zackion chat widget.
 *
 * Renders nothing itself — the script injects its own UI into the body.
 *
 * NOTE ON CLEANUP: removing the <script> tag does not unload the widget. Once
 * it has run it owns its own DOM nodes, listeners and timers, and nothing here
 * can reach those. The cleanup exists so a remount doesn't stack script tags;
 * it is not a teardown. If the widget ever needs to genuinely disappear, that
 * has to come from whatever API Zackion exposes.
 */
export function ExternalChat() {
  useEffect(() => {
    // StrictMode mounts effects twice in development, and a second copy of the
    // script means two widgets on screen.
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.dataset.key = BOT_KEY
    script.defer = true
    script.onerror = () => console.error('Zackion chat widget failed to load')
    document.body.appendChild(script)

    return () => script.remove()
  }, [])

  return null
}
