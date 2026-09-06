/**
 * Team pairing (spec section 37). The team types the join code printed on its
 * table card; the server exchanges it for a session bound to that team only.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { sound } from '../lib/sound.js';
import { useStore } from '../lib/store.js';

interface Props {
  onLogin: (token: string) => void;
}

export function Login({ onLogin }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authError = useStore((s) => (s.authFailed ? s.error : null));
  const round = useStore((s) => s.config.roundNumber);

  // Explain WHY the team was sent back here (usually an event reset).
  useEffect(() => {
    if (authError) setError(`${authError}. Please enter your join code again.`);
  }, [authError]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || code.trim().length === 0) return;
    setBusy(true);
    setError(null);
    sound.unlock();

    try {
      const response = await fetch('/api/auth/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: code.trim() }),
      });
      const payload = (await response.json()) as { token?: string; message?: string };
      if (!response.ok || !payload.token) {
        setError(payload.message ?? 'That join code was not recognised.');
        setBusy(false);
        return;
      }
      onLogin(payload.token);
    } catch {
      setError('Could not reach the game server. Check that you are on the event Wi-Fi.');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <motion.div
        className="login__card panel"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="login__brand">
          <div className="eyebrow">CSI CLUB PRESENTS</div>
          <h1 className="login__title">
            CODE<span className="login__title-accent">MARKET</span>
          </h1>
          <div className="login__round">ROUND {round} · CAPITAL · AUCTION · RISK</div>
        </div>

        <form onSubmit={submit} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="field">
            <label className="label" htmlFor="join-code">
              Team join code
            </label>
            <input
              id="join-code"
              className="input input--key"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              autoFocus
              aria-describedby="join-help"
            />
            <p id="join-help" className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Printed on your team card. Ask your volunteer if you cannot find it.
            </p>
          </div>

          {error ? (
            <motion.div
              className="login__error"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }}
              transition={{ duration: 0.36 }}
              role="alert"
            >
              {error}
            </motion.div>
          ) : null}

          <button
            className="btn btn--primary btn--lg btn--block"
            type="submit"
            disabled={busy || code.trim().length === 0}
          >
            {busy ? <span className="spinner" /> : null}
            {busy ? 'Joining…' : 'Enter the market'}
          </button>
        </form>

        <div className="login__foot dim">
          This event runs entirely on the local network. No internet required.
        </div>
      </motion.div>
    </div>
  );
}
