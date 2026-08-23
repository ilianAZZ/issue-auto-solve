import { useState } from 'react';

export function LoginScreen() {
  const [token, setToken] = useState('');

  function unlock() {
    window.location.href = `/login?token=${encodeURIComponent(token.trim())}`;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-bg">
      <div className="mx-auto max-w-[760px] px-6 pt-12 pb-16">
        <h1 className="mt-0 mb-1 text-2xl tracking-tight">This dashboard is locked</h1>
        <p className="mt-0 mb-7 text-muted">
          It can add repositories, replace credentials and read run logs, so it asks for the token printed in the
          server log at startup.
        </p>
        <div className="rounded-xl border border-border bg-panel p-5 shadow-[0_1px_2px_rgba(16,16,24,.06),0_8px_24px_rgba(16,16,24,.06)]">
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              placeholder="Dashboard token"
              className="min-w-[180px] flex-1 rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
            />
            <button
              onClick={unlock}
              className="rounded-lg border border-accent bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:brightness-110"
            >
              Unlock
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
