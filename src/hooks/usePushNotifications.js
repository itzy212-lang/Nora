// src/hooks/usePushNotifications.js
// Registers the browser for Web Push notifications and saves the subscription to the API.
// Call this once after login.

const VAPID_PUBLIC_KEY = 'BBs2TUvpmDbAcwytkPd_RjrssIxHeoQPkfARb64K7xX5NpRAwwSXrmDCdcPszGymPt6SCXErD1YDnghZH9pGEWU';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export async function registerPushNotifications(userId) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[push] Not supported in this browser');
      return false;
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[push] Permission denied');
      return false;
    }

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    // Save to API
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')))),
            auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')))),
          },
        },
        user_id: userId || 'help@sq1consulting.co.uk',
      }),
    });

    if (res.ok) {
      console.log('[push] Subscription registered');
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[push] Registration failed:', err.message);
    return false;
  }
}

export async function unregisterPushNotifications() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/push-subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: { endpoint: subscription.endpoint } }),
      });
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.warn('[push] Unregister failed:', err.message);
  }
}
