/**
 * The participant client (Round 3).
 *
 * Screen selection is derived entirely from authoritative server state, so a
 * reconnect always lands the team on the right screen. A team can always see:
 * capital, its own position, the current question, its status, the clock,
 * premium/auction state, its result and what happens next.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Login } from './Login.js';
import { TeamHeader } from './TeamHeader.js';
import { QuestionIntroScreen } from './QuestionIntroScreen.js';
import { QuestionScreen } from './QuestionScreen.js';
import { ChallengeScreen } from './ChallengeScreen.js';
import { PremiumIntroScreen } from './PremiumIntroScreen.js';
import { AuctionScreen } from './AuctionScreen.js';
import { PremiumScreen } from './PremiumScreen.js';
import { ReclaimScreen } from './ReclaimScreen.js';
import { ResultScreen } from './ResultScreen.js';
import { StrategyScreen } from './StrategyScreen.js';
import { WaitingScreen } from './WaitingScreen.js';
import { FinalScreen } from './FinalScreen.js';

const TOKEN_KEY = 'cm.participant.token';

export type Screen =
  | 'waiting'
  | 'question_intro'
  | 'question'
  | 'solving'
  | 'premium_intro'
  | 'auction'
  | 'premium'
  | 'reclaim'
  | 'result'
  | 'strategy'
  | 'final';

export function ParticipantApp() {
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
  const connection = useStore((s) => s.connection);
  const authFailed = useStore((s) => s.authFailed);

  useEffect(() => {
    if (!token) return;
    connect(token, 'participant');
    return () => disconnect();
  }, [token, connect, disconnect]);

  // A stored session stops working when the organizer resets the event
  // database. Drop it and show the join screen instead of spinning forever.
  useEffect(() => {
    if (!authFailed) return;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, [authFailed]);

  const handleLogin = (nextToken: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, nextToken);
    } catch {
      /* private browsing: the session simply will not survive a refresh */
    }
    setToken(nextToken);
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    disconnect();
    setToken(null);
  };

  if (!token) return <Login onLogin={handleLogin} />;

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot__mark">CODE&nbsp;MARKET</div>
        <div className="row" style={{ gap: 10 }}>
          <span className="spinner" />
          <span className="muted">
            {connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting to the game server…'}
          </span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={handleLogout} style={{ marginTop: 24 }}>
          Use a different join code
        </button>
      </div>
    );
  }

  return <ParticipantShell onLogout={handleLogout} />;
}

function ParticipantShell({ onLogout }: { onLogout: () => void }) {
  const screen = useScreen();

  return (
    <div className="app-shell participant">
      <TeamHeader onLogout={onLogout} />
      <main className="participant__main container">
        {/*
          Screen swaps are ENTER-ONLY and keyed by screen name. An exit-based
          cross-fade makes the swap depend on an exit animation completing; if
          that ever stalls, a team is left staring at the previous screen while
          the round moves on.
        */}
        <motion.div
          key={screen}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="participant__screen"
        >
          {screen === 'question_intro' ? <QuestionIntroScreen /> : null}
          {screen === 'question' ? <QuestionScreen /> : null}
          {screen === 'solving' ? <ChallengeScreen /> : null}
          {screen === 'premium_intro' ? <PremiumIntroScreen /> : null}
          {screen === 'auction' ? <AuctionScreen /> : null}
          {screen === 'premium' ? <PremiumScreen /> : null}
          {screen === 'reclaim' ? <ReclaimScreen /> : null}
          {screen === 'result' ? <ResultScreen /> : null}
          {screen === 'strategy' ? <StrategyScreen /> : null}
          {screen === 'final' ? <FinalScreen /> : null}
          {screen === 'waiting' ? <WaitingScreen /> : null}
        </motion.div>
      </main>
    </div>
  );
}

/** Pure derivation of the visible screen from server state. */
export function useScreen(): Screen {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.me);
  const question = useStore((s) => s.question);
  const premium = useStore((s) => s.premium);

  if (!game) return 'waiting';

  // A reclaim offer addressed to this team always wins - it is time-critical.
  if (me?.reclaimOffer) return 'reclaim';

  switch (game.phase) {
    case 'final_results':
    case 'completed':
      return 'final';

    case 'strategy_phase':
      return 'strategy';

    case 'question_intro':
      return question ? 'question_intro' : 'waiting';

    case 'question_active':
      if (me?.questionState === 'in_progress') return 'solving';
      if (me?.questionState === 'submitted' || me?.questionState === 'resolved') return 'result';
      if (me?.questionState === 'skipped') return 'result';
      return question ? 'question' : 'waiting';

    case 'question_result':
    case 'premium_result':
      return 'result';

    case 'premium_intro':
      return 'premium_intro';

    case 'auction_active':
      return 'auction';

    case 'premium_authorized':
      return premium?.activeTeamId === me?.teamId ? 'premium' : 'auction';

    case 'premium_solving':
      if (premium?.activeTeamId !== me?.teamId) return 'waiting';
      return me?.questionState === 'in_progress' ? 'solving' : 'premium';

    case 'reclaim':
      return 'waiting';

    case 'paused':
    case 'idle':
    default:
      return 'waiting';
  }
}
