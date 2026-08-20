// Firebase Cloud Messaging requires a service worker at the site root to
// deliver notifications while the app isn't open/focused. These config
// values are public client identifiers (not secrets — the same values are
// already embedded in the built app bundle); security comes from Firebase
// Auth + Firestore rules, not from hiding these.
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyB2H-cIP67lbW0amDtACMQwRYhLTSN_Xns',
  authDomain: 'devotional-app-c2633.firebaseapp.com',
  projectId: 'devotional-app-c2633',
  storageBucket: 'devotional-app-c2633.firebasestorage.app',
  messagingSenderId: '205410997272',
  appId: '1:205410997272:web:aaf7006381448a71821f6d',
})

const messaging = firebase.messaging()

// Background messages (app closed or tab not focused) arrive here; FCM's
// "notification" payload is shown automatically by the browser, this hook is
// only needed if we want to customize it later.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {}
  if (!title) return
  self.registration.showNotification(title, { body })
})
