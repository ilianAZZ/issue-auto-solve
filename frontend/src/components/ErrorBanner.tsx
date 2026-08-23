import { useEffect, useRef, useState } from 'react';
import { onError } from '../lib/errorBus';

const AUTO_DISMISS_MS = 8000;

export function ErrorBanner() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      onError((msg) => {
        setMessage(msg);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setMessage(null), AUTO_DISMISS_MS);
      }),
    [],
  );

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(null);
  }

  if (!message) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-3">
      <div
        role="alert"
        className="flex max-w-[640px] items-start gap-3 rounded-lg border border-red/30 bg-red-soft px-4 py-2.5 text-[13px] text-red shadow-[0_4px_16px_rgba(16,16,24,.12)]"
      >
        <span className="flex-1 break-words">{message}</span>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-red/70 hover:text-red">
          ✕
        </button>
      </div>
    </div>
  );
}
