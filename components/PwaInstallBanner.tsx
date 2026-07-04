'use client';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type BannerState = 'hidden' | 'android' | 'ios';

const DISMISSED_KEY = 'pwa-install-dismissed';

export default function PwaInstallBanner() {
  const [state, setState] = useState<BannerState>('hidden');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already installed as a PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // User dismissed the banner earlier
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as Navigator & { standalone?: boolean }).standalone;

    if (isIos) {
      setState('ios');
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setState('android');
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setState('hidden');
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setState('hidden');
    }
    setDeferredPrompt(null);
  };

  if (state === 'hidden') return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto">
      <div className="bg-slate-900 text-white rounded-xl shadow-2xl p-4 flex items-start gap-3 border border-slate-700">
        <div className="shrink-0 w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Install Kvitto</p>
          {state === 'android' && (
            <>
              <p className="text-xs text-slate-400 mt-0.5">
                Add to your home screen for quick access without the browser.
              </p>
              <button
                onClick={install}
                className="mt-2 bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
              >
                Install
              </button>
            </>
          )}
          {state === 'ios' && (
            <p className="text-xs text-slate-400 mt-0.5">
              Tap{' '}
              <svg className="inline w-3.5 h-3.5 -mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l-3 3h2v8h2V5h2l-3-3zM5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6h-2v5H7v-5H5z" />
              </svg>{' '}
              and then <strong>Add to Home Screen</strong>.
            </p>
          )}
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 text-slate-400 hover:text-white transition-colors p-1 -mt-1 -mr-1"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
