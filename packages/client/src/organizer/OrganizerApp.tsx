/**
 * The organizer dashboard (spec sections 30-32).
 *
 * One screen, everything the operator needs, no hunting. The auction control is
 * the fastest surface in the product: one click per bid, no typing.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { OrganizerLogin } from './OrganizerLogin.js';
import { GameControl } from './GameControl.js';
import { AuctionControl } from './AuctionControl.js';
import { PremiumControl } from './PremiumControl.js';
import { LiveEventsPanel } from './LiveEventsPanel.js';
import { TeamsPanel } from './TeamsPanel.js';
import { EventLog } from './EventLog.js';
import { ConfigPanel } from './ConfigPanel.js';
import { SimulationPanel } from './SimulationPanel.js';
import { ExportPanel } from './ExportPanel.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { fadeUp } from '../lib/motion.js';

const TOKEN_KEY = 'cm.organizer.token';

type Tab = 'control' | 'teams' | 'config' | 'log' | 'tools';

export function OrganizerApp() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const connect = useStore((s) => s.connect);
  const disconnect = useStore((s) => s.disconnect);
  const ready = useStore((s) => s.ready);
  const authFailed = useStore((s) => s.authFailed);

  useEffect(() => {
    if (!token) return;
    connect(token, 'organizer');
    return () => disconnect();
  }, [token, connect, disconnect]);

  // The console's saved token stops working after a database reset; fall back
  // to the passcode screen rather than reconnecting in a loop.
  useEffect(() => {
    if (!authFailed) return;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, [authFailed]);

  const login = (next: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, next);
    } catch {
      /* ignore */
    }
    setToken(next);
  };

  const logout = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    disconnect();
    setToken(null);
  };

  if (!token) return <OrganizerLogin onLogin={login} />;

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot__mark">ORGANIZER CONSOLE</div>
        <div className="row" style={{ gap: 10 }}>
          <span className="spinner" />
          <span className="muted">Connecting to the game server…</span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={logout} style={{ marginTop: 24 }}>
          Sign out
        </button>
      </div>
    );
  }

  return <OrganizerShell token={token} onLogout={logout} />;
}

function OrganizerShell({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('control');
  const game = useStore((s) => s.game);
  const teams = useStore((s) => s.teams);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const liveEvents = useStore((s) => s.liveEvents);

  const online = teams.filter((t) => t.connectionStatus === 'online').length;
  const attention = liveEvents.filter((e) => e.needsAttention).length;

  return (
    <div className="app-shell organizer">
      <header className="oheader">
        <div className="oheader__brand">
          <span className="oheader__mark">CODE MARKET</span>
          <span className="badge badge--accent">OPERATOR</span>
        </div>

        <nav className="oheader__tabs" role="tablist" aria-label="Dashboard sections">
          {(
            [
              ['control', 'Control'],
              ['teams', 'Teams'],
              ['config', 'Config'],
              ['log', 'Event log'],
              ['tools', 'Tools'],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className="oheader__tab"
              data-active={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
              {value === 'control' && attention > 0 ? (
                <span className="oheader__pip">{attention}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="oheader__status">
          <span className="badge" data-phase={game?.phase}>
            {(game?.phase ?? 'lobby').replace(/_/g, ' ').toUpperCase()}
          </span>
          <span className="badge badge--dot" data-online={online > 0}>
            {online}/{teams.length} ONLINE
          </span>
          <button className="btn btn--ghost btn--sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="organizer__main">
        {tab === 'control' ? (
          <motion.div className="organizer__grid" variants={fadeUp} initial="hidden" animate="show">
            <div className="organizer__col organizer__col--main">
              <GameControl />
              <AuctionControl />
              <PremiumControl />
            </div>
            <div className="organizer__col organizer__col--side">
              <LiveEventsPanel />
              <div className="panel panel--flush">
                <div className="panel__head">
                  <span className="panel__title">Live leaderboard</span>
                  <span className="badge">Top {config.qualifiers} qualify</span>
                </div>
                <div style={{ padding: 'var(--sp-3)', maxHeight: 520, overflowY: 'auto' }}>
                  <Leaderboard
                    rows={leaderboard}
                    qualifiers={config.qualifiers}
                    currencySymbol={config.currencySymbol}
                    changed={changed}
                    variant="compact"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}

        {tab === 'teams' ? <TeamsPanel token={token} /> : null}
        {tab === 'config' ? <ConfigPanel /> : null}
        {tab === 'log' ? <EventLog token={token} /> : null}
        {tab === 'tools' ? (
          <div className="organizer__grid">
            <div className="organizer__col organizer__col--main">
              <SimulationPanel />
            </div>
            <div className="organizer__col organizer__col--side">
              <ExportPanel token={token} />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
