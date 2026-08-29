/**
 * The participant client (spec sections 21, 22, 23).
 *
 * Screen selection is derived entirely from authoritative server state, so a
 * reconnect always lands the team on the right screen. The team can always see:
 * capital, rank, the current challenge, its status, the clock, whether they won
 * a premium, their bid, their risk, the result and the next opportunity.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { isPremiumType } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { Login } from './Login.js';
import { TeamHeader } from './TeamHeader.js';
import { MarketScreen } from './MarketScreen.js';
import { ChallengeScreen } from './ChallengeScreen.js';
import { AuctionScreen } from './AuctionScreen.js';
import { PremiumScreen } from './PremiumScreen.js';
import { ReclaimScreen } from './ReclaimScreen.js';
import { ResultScreen } from './ResultScreen.js';
import { WaitingScreen } from './WaitingScreen.js';
import { FinalScreen } from './FinalScreen.js';

const TOKEN_KEY = 'cm.participant.token';

type Screen =
  | 'waiting'
  | 'market'
  | 'challenge'
  | 'auction'
  | 'premium'
  | 'reclaim'
  | 'result'
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
          cross-fade (AnimatePresence mode="wait") makes the swap depend on an
          exit animation completing; if that ever stalls, a team is left staring
          at the previous screen while the round moves on. During a live event
          that is unacceptable, so the new screen mounts immediately and simply
          animates in.
        */}
        <motion.div
          key={screen}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="participant__screen"
        >
          {screen === 'market' ? <MarketScreen /> : null}
          {screen === 'challenge' ? <ChallengeScreen /> : null}
          {screen === 'auction' ? <AuctionScreen /> : null}
          {screen === 'premium' ? <PremiumScreen /> : null}
          {screen === 'reclaim' ? <ReclaimScreen /> : null}
          {screen === 'result' ? <ResultScreen /> : null}
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
  const challenge = useStore((s) => s.challenge);
  const premium = useStore((s) => s.premium);

  if (!game) return 'waiting';
  if (game.phase === 'complete') return 'final';

  if (me?.reclaimOffer) return 'reclaim';

  if (game.phase === 'auction' || game.phase === 'final') {
    if (game.phase === 'final' && !game.currentAuctionId) return 'waiting';
    // The winner moves to the premium screen the moment the hammer falls.
    if (premium?.activeTeamId === me?.teamId && premium?.stage !== 'auction') return 'premium';
    return 'auction';
  }

  if (game.phase === 'premium_attempt' || game.phase === 'premium_reclaim') {
    if (premium?.activeTeamId === me?.teamId) {
      return me?.challengeState === 'in_progress' ? 'challenge' : 'premium';
    }
    return 'waiting';
  }

  if (game.phase === 'market' && challenge && !isPremiumType(challenge.marketType)) {
    if (me?.challengeState === 'in_progress') return 'challenge';
    if (me?.challengeState === 'resolved' || me?.challengeState === 'submitted') return 'result';
    return 'market';
  }

  if (game.phase === 'result') return 'result';

  return 'waiting';
}
