/**
 * Service-worker registration and install-prompt plumbing.
 *
 * Kept framework-free so it can be unit-tested without a DOM renderer.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Registered in `main.tsx`; safe to call repeatedly (idempotent). */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
}

type PromptListener = (event: BeforeInstallPromptEvent | null) => void;

const listeners = new Set<PromptListener>();
/** Saved until consumed by `promptInstall` — Chrome allows one use. */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

function emit() {
  for (const fn of listeners) fn(deferredPrompt);
}

/**
 * Subscribes to install availability. Returns an unsubscribe function.
 * Fires immediately with the current state, then on every change.
 */
export function onInstallAvailable(fn: PromptListener): () => void {
  listeners.add(fn);
  fn(deferredPrompt);
  return () => listeners.delete(fn);
}

/** Whether the app already runs as an installed PWA. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Shows the browser install prompt. Resolves with the user's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

/** Wire the global `beforeinstallprompt`/`appinstalled` listeners once. */
export function initInstallPrompting(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar; the app shows its own banner.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
  });
}
