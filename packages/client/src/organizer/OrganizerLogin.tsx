import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';

interface ConnectionInfo {
  participantUrl: string;
  organizerUrl: string;
  projectorUrl: string;
  addresses: { url: string; iface: string; private: boolean }[];
}

export function OrganizerLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const authError = useStore((s) => (s.authFailed ? s.error : null));

  useEffect(() => {
    if (authError) setError(`${authError}. Sign in again.`);
  }, [authError]);

  // Show the LAN URLs on the login screen: the operator needs them before
  // anything else on event day (spec section 40).
  useEffect(() => {
    fetch('/api/connection')
      .then((r) => r.json())
      .then((data: ConnectionInfo) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/organizer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const payload = (await response.json()) as { token?: string; message?: string };
      if (!response.ok || !payload.token) {
        setError(payload.message ?? 'Incorrect passcode');
        setBusy(false);
        return;
      }
      onLogin(payload.token);
    } catch {
      setError('Could not reach the game server.');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <motion.div
        className="login__card panel"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="login__brand">
          <div className="eyebrow">CODE MARKET</div>
          <h1 className="login__title">OPERATOR CONSOLE</h1>
          <div className="login__round">Round 2 event control</div>
        </div>

        <form onSubmit={submit} className="stack">
          <div className="field">
            <label className="label" htmlFor="passcode">
              Operator passcode
            </label>
            <input
              id="passcode"
              className="input input--key"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="••••"
              autoFocus
              autoComplete="off"
            />
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Printed in the server console when the game server started.
            </p>
          </div>

          {error ? (
            <motion.div
              className="login__error"
              animate={{ x: [0, -6, 6, -3, 0] }}
              transition={{ duration: 0.32 }}
              role="alert"
            >
              {error}
            </motion.div>
          ) : null}

          <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Open console
          </button>
        </form>

        {info ? (
          <div className="login__lan">
            <div className="label">Event connection details</div>
            <ul className="login__lan-list">
              <li>
                <span className="dim">Participants</span>
                <code>{info.participantUrl}</code>
              </li>
              <li>
                <span className="dim">Projector</span>
                <code>{info.projectorUrl}</code>
              </li>
            </ul>
            {info.addresses.length === 0 ? (
              <p className="login__lan-warn">
                No LAN address detected — connect this machine to the event router.
              </p>
            ) : null}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
