/**
 * Projector mode (spec section 16).
 *
 * Rules this surface obeys:
 *  - NO operator controls, ever.
 *  - Readable from the back of a hall: huge type, minimal chrome.
 *  - It switches itself from the game phase, and the organizer can pin a mode.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { ProjectorLeaderboard } from './ProjectorLeaderboard.js';
import { ProjectorQuestion } from './ProjectorQuestion.js';
import { ProjectorPremiumIntro } from './ProjectorPremiumIntro.js';
import { ProjectorAuction } from './ProjectorAuction.js';
import { ProjectorReclaim } from './ProjectorReclaim.js';
import { ProjectorStrategy } from './ProjectorStrategy.js';
import { ProjectorFinalStretch } from './ProjectorFinalStretch.js';
import { ProjectorPodium } from './ProjectorPodium.js';
import { ProjectorResult } from './ProjectorResult.js';
import { sound } from '../lib/sound.js';

type View =
  | 'leaderboard'
  | 'question'
  | 'premium_intro'
  | 'auction'
  | 'reclaim'
  | 'strategy'
  | 'final_stretch'
  | 'podium'
  | 'result';

export function ProjectorApp() {
  const connect = useStore((s) => s.connect);
  const disconnect = useStore((s) => s.disconnect);
  const ready = useStore((s) => s.ready);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/auth/projector', { method: 'POST' });
        const payload = (await response.json()) as { token?: string };
        if (!cancelled && payload.token) connect(payload.token, 'projector');
        else if (!cancelled) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [connect, disconnect]);

  // The projector mutes itself by default so the hall PA stays in charge.
  useEffect(() => {
    sound.setMuted(true);
  }, []);

  if (failed) {
    return (
      <div className="projector-scope projector projector--boot">
        <h1>Cannot reach the game server</h1>
        <p className="muted">Check that the organizer server is running on this network.</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="projector-scope projector projector--boot">
        <motion.h1
          className="projector__wordmark"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          CODE MARKET
        </motion.h1>
        <p className="muted">Connecting…</p>
      </div>
    );
  }

  return <ProjectorStage />;
}

function ProjectorStage() {
  const view = useProjectorView();

  return (
    <div className="projector-scope projector" data-view={view}>
      {/*
        Enter-only, keyed by view. The hall display must never be one beat
        behind the room because an exit animation did not resolve.
      */}
      <motion.div
        key={view}
        className="projector__view"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      >
        {view === 'leaderboard' ? <ProjectorLeaderboard /> : null}
        {view === 'question' ? <ProjectorQuestion /> : null}
        {view === 'premium_intro' ? <ProjectorPremiumIntro /> : null}
        {view === 'auction' ? <ProjectorAuction /> : null}
        {view === 'reclaim' ? <ProjectorReclaim /> : null}
        {view === 'strategy' ? <ProjectorStrategy /> : null}
        {view === 'final_stretch' ? <ProjectorFinalStretch /> : null}
        {view === 'podium' ? <ProjectorPodium /> : null}
        {view === 'result' ? <ProjectorResult /> : null}
      </motion.div>
    </div>
  );
}

/** Auto mode follows the game; a pinned mode always wins. */
export function useProjectorView(): View {
  const mode = useStore((s) => s.projectorMode);
  const game = useStore((s) => s.game);
  const auction = useStore((s) => s.auction);
  const hidden = useStore((s) => s.leaderboardHidden);

  if (mode !== 'auto') return mode as View;

  switch (game?.phase) {
    case 'completed':
    case 'final_results':
      return 'podium';

    case 'strategy_phase':
      return 'strategy';

    case 'reclaim':
      return 'reclaim';

    case 'question_intro':
      return 'question';

    case 'premium_intro':
      // The auction view has nothing to draw before an auction exists; the
      // room gets the premium's card instead.
      return 'premium_intro';

    case 'auction_active':
    case 'premium_authorized':
      return 'auction';

    case 'premium_solving':
      return 'auction';

    case 'premium_result':
      return auction?.auction.winnerTeamId ? 'result' : hidden ? 'final_stretch' : 'leaderboard';

    case 'question_active':
      // While the board is sealed the hall gets the suspense card instead.
      return hidden ? 'final_stretch' : 'question';

    default:
      return hidden ? 'final_stretch' : 'leaderboard';
  }
}
