/**
 * Team join (self-service).
 *
 * There is no printed roster: a team opens the event IP link and types its TEAM
 * NAME to join. A new name creates the team; an existing name re-joins it (a
 * teammate's second laptop, or a reconnect). A join code is offered only as a
 * fallback for a team the organizer pre-created with a printed card.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { sound } from '../lib/sound.js';
import { useStore } from '../lib/store.js';

interface Props {
  onLogin: (token: string) => void;
}

type Mode = 'name' | 'code';

export function Login({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>('name');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authError = useStore((s) => (s.authFailed ? s.error : null));
  const round = useStore((s) => s.config.roundNumber);

  // Explain WHY the team was sent back here (usually an event reset).
  useEffect(() => {
    if (authError) setError(`${authError}. Enter your team name again to rejoin.`);
  }, [authError]);

  const value = mode === 'name' ? name : code;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || value.trim().length === 0) return;
    setBusy(true);
    setError(null);
    sound.unlock();

    const request =
      mode === 'name'
        ? { url: '/api/auth/team/register', body: { name: name.trim() }, fallback: 'Could not join. Try a different name.' }
        : { url: '/api/auth/team', body: { joinCode: code.trim() }, fallback: 'That join code was not recognised.' };

    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const payload = (await response.json()) as { token?: string; message?: string };
      if (!response.ok || !payload.token) {
        setError(payload.message ?? request.fallback);
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
          {mode === 'name' ? (
            <div className="field">
              <label className="label" htmlFor="team-name">
                Your team name
              </label>
              <input
                id="team-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. CODEFORCE"
                autoComplete="off"
                maxLength={24}
                autoFocus
                aria-describedby="join-help"
              />
              <p id="join-help" className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                Pick your team name to join. If a teammate has already joined, type the same name to
                join them.
              </p>
            </div>
          ) : (
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
                Only if the organizer gave your team a printed code.
              </p>
            </div>
          )}

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
            disabled={busy || value.trim().length === 0}
          >
            {busy ? <span className="spinner" /> : null}
            {busy ? 'Joining…' : 'Enter the market'}
          </button>
        </form>

        <button
          type="button"
          className="login__switch"
          onClick={() => {
            setMode((m) => (m === 'name' ? 'code' : 'name'));
            setError(null);
          }}
        >
          {mode === 'name' ? 'Have a printed join code? Use it instead' : 'Join with a team name instead'}
        </button>

        <div className="login__foot dim">
          This event runs entirely on the local network. No internet required.
        </div>
      </motion.div>
    </div>
  );
}
