import { useEffect, useState } from 'react';
import {
  initInstallPrompting,
  isStandalone,
  onInstallAvailable,
  promptInstall,
  type BeforeInstallPromptEvent,
} from './register';

export type InstallState = 'installed' | 'available' | 'unavailable';

/**
 * React binding for the PWA install lifecycle.
 *
 * - `installed` — running standalone (banner hidden)
 * - `available` — browser offered installation (banner shown)
 * - `unavailable` — already installed via banner or not installable
 */
export function usePwaInstall(): {
  state: InstallState;
  install: () => void;
} {
  const [state, setState] = useState<InstallState>(() =>
    isStandalone() ? 'installed' : 'unavailable',
  );

  useEffect(() => {
    initInstallPrompting();

    const onPrompt = (event: BeforeInstallPromptEvent | null) => {
      if (isStandalone()) {
        setState('installed');
      } else {
        setState(event ? 'available' : 'unavailable');
      }
    };

    // Also re-check on display-mode changes (e.g. user just installed).
    const mq = window.matchMedia('(display-mode: standalone)');
    const onMode = () => onPrompt(null);
    mq.addEventListener?.('change', onMode);

    const unsubscribe = onInstallAvailable(onPrompt);
    return () => {
      unsubscribe();
      mq.removeEventListener?.('change', onMode);
    };
  }, []);

  return {
    state,
    install: () => {
      void promptInstall();
    },
  };
}
