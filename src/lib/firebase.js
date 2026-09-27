import { initializeApp } from 'firebase/app'
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import { supabase } from './supabase'

const firebaseConfig = {
  apiKey: 'AIzaSyB2H-cIP67lbW0amDtACMQwRYhLTSN_Xns',
  projectId: 'devotional-app-c2633',
  messagingSenderId: '205410997272',
  appId: '1:205410997272:web:aaf7006381448a71821f6d',
}

const VAPID_KEY =
  'BEjlTXe1ODOh1IDAwc0T6exHRxMX5TQAZTsDp17t39Skz8wjWp82hqdjYXHDgtp7_TrKWqYHJyXqOjxerhY7VsU'

// The worker moved: caching and FCM now live in one file, because only one
// worker can own scope "/". See lib/serviceWorker.js.
import { getServiceWorkerRegistration } from './serviceWorker'
import { isIos, isStandalone } from './pwaInstall'

const firebaseApp = initializeApp(firebaseConfig)
const messagingPromise = isSupported().then((supported) =>
  supported ? getMessaging(firebaseApp) : null
)

// Stable per-install identity. iOS Safari reissues FCM tokens on OS/app
// updates and site-data clears; without a device id the rotated token lands
// as an extra device_tokens row and every reminder pushes twice to the same
// device ("double alert"). Each install context (PWA, browser profile) gets
// its own id, so enableNotifications() can retire that context's old token
// instead of piling up a second one.
const DEVICE_ID_KEY = 'selah-device-id'
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return null // storage unavailable (private mode): register without device id
  }
}

export async function enableNotifications(userId) {
  const messaging = await messagingPromise
  if (!messaging || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }
  // iOS web push only works from the installed Home Screen app. Registering
  // from a Safari tab would add a second token for this device that can never
  // receive a push (double alerts) — block before the permission prompt so
  // nobody is asked to grant something useless.
  if (isIos() && !isStandalone()) return 'ios-install-required'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'unsupported'

  // No worker is registered in dev (see lib/serviceWorker.js), and
  // `serviceWorker.ready` never settles when there is nothing to wait for —
  // so bail instead of hanging the caller's await forever.
  if (!(await getServiceWorkerRegistration())) return 'unsupported'
  const registration = await navigator.serviceWorker.ready
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return 'unsupported'

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // One live token per install context: retire this context's previous token
  // (if any) before upserting, so a Safari-reissued token replaces the old
  // one instead of joining it as a second push target for the same device.
  const deviceId = getDeviceId()
  if (deviceId) {
    await supabase
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .neq('token', token)
  }
  await supabase
    .from('device_tokens')
    .upsert({ token, user_id: userId, device_id: deviceId }, { onConflict: 'token' })
  await supabase
    .from('notification_profiles')
    .upsert({ user_id: userId, timezone }, { onConflict: 'user_id' })
  return 'granted'
}

export async function disableNotifications(userId) {
  const messaging = await messagingPromise
  if (!messaging) return
  const registration = await getServiceWorkerRegistration()
  if (!registration?.active) return
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  }).catch(() => null)
  if (token) {
    await supabase.from('device_tokens').delete().eq('token', token).eq('user_id', userId)
  }
}

export async function onForegroundMessage(callback) {
  const messaging = await messagingPromise
  if (!messaging) return () => {}
  return onMessage(messaging, (payload) => {
    const { title, body } = payload.notification ?? {}
    if (title) callback(title, body)
  })
}

export async function sendTestConquestReminder() {
  const { data, error } = await supabase.functions.invoke('send-test-conquest-reminder')
  if (error) throw error
  return data
}
