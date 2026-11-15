// Service-worker registration and the in-app "reload" button.

import { registerSW } from 'virtual:pwa-register';

export const BUILD = {
  number: __BUILD_NUMBER__,
  sha: __BUILD_SHA__,
  time: __BUILD_TIME__,
};

let registration: ServiceWorkerRegistration | undefined;

export function initServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
    },
  });
}

/** Wait until a newly found service worker is active (or give up after `ms`). */
function waitForActivation(worker: ServiceWorker, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (worker.state === 'activated') return resolve();
    const timer = setTimeout(resolve, ms);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/**
 * Check for a new version, install it if there is one, then reload the page.
 * The game saves after every action, so reloading never loses progress.
 */
export async function reloadApp(): Promise<void> {
  try {
    if (registration) {
      await registration.update();
      const incoming = registration.installing ?? registration.waiting;
      if (incoming) await waitForActivation(incoming, 8000);
    }
  } catch {
    // Offline or the check failed: just reload what we have.
  }
  window.location.reload();
}
