// src/hooks/usePushNotifications.js
// Registers the browser for Web Push notifications and saves the subscription to the API.
// Call this once after login.

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

    // Fixed 2026-08-14: real, confirmed bug — this used to be a
    // hardcoded string here, completely disconnected from the actual
    // VAPID_PUBLIC_KEY configured server-side. Confirmed live: they'd
    // drifted apart at some point, causing every real send to fail
    // with a 403 'unexpected response code' — VAPID auth failure —
    // for every existing subscription. Now fetches the real, current
    // key from the server every time, so this can't silently drift
    // again.
    const keyRes = await fetch('/api/vapid-public-key');
    if (!keyRes.ok) {
      console.warn('[push] Could not fetch VAPID public key');
      return false;
    }
    const { publicKey: VAPID_PUBLIC_KEY } = await keyRes.json();

    // Get service worker registration
    const registration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    // Fixed 2026-08-14: real, confirmed bug — this only ever subscribed
    // when NO subscription existed at all. If one already existed
    // (even one created with a now-stale, mismatched key — exactly
    // what happened here), it was reused forever, never refreshed.
    // Now checks whether the existing subscription's key actually
    // matches the current one, and re-subscribes if it doesn't.
    if (subscription) {
      const currentKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const existingKey = new Uint8Array(subscription.options?.applicationServerKey || []);
      const keysMatch = existingKey.length === currentKey.length &&
        existingKey.every((byte, i) => byte === currentKey[i]);
      if (!keysMatch) {
        console.log('[push] Existing subscription uses a stale key — re-subscribing');
        const oldEndpoint = subscription.endpoint;
        await subscription.unsubscribe();
        // Also remove the old row server-side — unsubscribing here only
        // invalidates it client-side; without this, a dead endpoint
        // would keep sitting in push_subscriptions indefinitely.
        fetch('/api/push-subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: { endpoint: oldEndpoint } }),
        }).catch(() => {});
        subscription = null;
      }
    }

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
