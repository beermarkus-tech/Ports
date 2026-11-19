// Service-worker registration, update checks and the in-app reload button.
//
// Each build ships a small version.json (never cached by the service worker).
// The reload button fetches it fresh to learn the latest build number, so it
// knows for certain whether an update exists instead of relying on the
// browser's own service-worker update check.

import { registerSW } from 'virtual:pwa-register';

export const BUILD = {
  number: __BUILD_NUMBER__,
  sha: __BUILD_SHA__,
  time: __BUILD_TIME__,
};

const UPDATED_FLAG = 'deadweight.updatedFrom';

export function initServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}

/** The newest build number on the server, or null if it can't be reached. */
export async function latestBuild(): Promise<number | null> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { number?: string };
    const n = Number(data.number);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function isNewer(latest: number | null): boolean {
  return latest !== null && latest > Number(BUILD.number);
}

/**
 * Drop the offline copy (service worker and its caches) and load the page
 * fresh from the server. Saves live in localStorage, which this doesn't touch.
 */
async function installFresh(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Fall through to a plain reload.
  }
  window.location.reload();
}

export type ReloadOutcome = 'updating' | 'latest' | 'offline';

/** What the reload button does: check, then update if there's a newer build. */
export async function reloadApp(): Promise<ReloadOutcome> {
  const latest = await latestBuild();
  if (latest === null) return 'offline';
  if (!isNewer(latest)) return 'latest';
  try {
    sessionStorage.setItem(UPDATED_FLAG, BUILD.number);
  } catch {
    /* private mode: no "updated" message, that's all */
  }
  await installFresh();
  return 'updating';
}

/** Was the page just reloaded by an update? (Doesn't consume the note.) */
export function justUpdated(): boolean {
  try {
    return sessionStorage.getItem(UPDATED_FLAG) !== null;
  } catch {
    return false;
  }
}

/** If the page was just reloaded by an update, the build it came from. */
export function consumeUpdatedFrom(): string | null {
  try {
    const from = sessionStorage.getItem(UPDATED_FLAG);
    sessionStorage.removeItem(UPDATED_FLAG);
    return from && from !== BUILD.number ? from : null;
  } catch {
    return null;
  }
}
