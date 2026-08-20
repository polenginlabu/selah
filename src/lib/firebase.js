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

const SERVICE_WORKER_PATH = '/firebase-messaging-sw.js'

const firebaseApp = initializeApp(firebaseConfig)
const messagingPromise = isSupported().then((supported) =>
  supported ? getMessaging(firebaseApp) : null
)

export async function enableNotifications(userId) {
  const messaging = await messagingPromise
  if (!messaging || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'unsupported'

  await navigator.serviceWorker.register(SERVICE_WORKER_PATH)
  const registration = await navigator.serviceWorker.ready
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return 'unsupported'

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  await supabase.from('device_tokens').upsert({ token, user_id: userId })
  await supabase.from('notification_profiles').upsert({ user_id: userId, timezone })
  return 'granted'
}

export async function disableNotifications(userId) {
  const messaging = await messagingPromise
  if (!messaging) return
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
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
