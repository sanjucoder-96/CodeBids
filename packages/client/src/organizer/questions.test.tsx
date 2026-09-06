/**
 * The question-keys panel.
 *
 * The operator reads a key aloud before every normal question, so this panel
 * is on the critical path of the event: if it shows the wrong key, or hides the
 * open one, the room stalls. It also has to say plainly that a premium has no
 * key to read, because the server authorises the auction winner itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_CONFIG, type GameState, type SequenceEntry } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { QuestionsPanel } from './QuestionsPanel.js';

afterEach(cleanup);

const POOL = [
  {
    id: 'N01',
    kind: 'normal',
    title: 'Slice of Life',
    domain: 'output_prediction',
    difficulty: 'easy',
    timeLimit: 60,
    accessKey: 'Q-4417',
  },
  {
    id: 'N20',
    kind: 'normal',
    title: 'Prototype Chain',
    domain: 'oop',
    difficulty: 'hard',
    timeLimit: 120,
    accessKey: 'Q-2277',
  },
  {
    id: 'N26',
    kind: 'normal',
    title: 'Recursion Depth',
    domain: 'dsa',
    difficulty: 'very_hard',
    timeLimit: 150,
    accessKey: 'Q-7702',
  },
  {
    id: 'P1',
    kind: 'premium',
    title: 'Algorithms Vault',
    domain: 'algorithms',
    difficulty: 'hard',
    timeLimit: 120,
    accessKey: 'PRM-6640',
  },
];

/** N01 and P1 are drawn into the round; N20 and N26 are not. */
const SEQUENCE: SequenceEntry[] = [
  {
    index: 1,
    blockNumber: 1,
    positionInBlock: 1,
    kind: 'normal',
    questionId: 'N01',
    state: 'active',
    title: 'Slice of Life',
    domain: 'output_prediction',
    difficulty: 'easy',
    timeLimit: 60,
    isFinalPremium: false,
    inFinalStretch: false,
  },
  {
    index: 2,
    blockNumber: 1,
    positionInBlock: 2,
    kind: 'premium',
    questionId: 'P1',
    state: 'pending',
    title: 'Algorithms Vault',
    domain: 'algorithms',
    difficulty: 'hard',
    timeLimit: 120,
    isFinalPremium: false,
    inFinalStretch: false,
  },
];

const game = (over: Partial<GameState> = {}): GameState => ({
  phase: 'question_active',
  resumePhase: null,
  slotIndex: 1,
  currentQuestionId: 'N01',
  currentAuctionId: null,
  blockNumber: 1,
  totalBlocks: 4,
  totalSlots: 16,
  finalStretch: false,
  timer: { endsAt: null, duration: null, label: null },
  serverNow: Date.now(),
  startedAt: 1,
  completedAt: null,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => POOL })),
  );
  useStore.setState({ config: DEFAULT_CONFIG, sequence: SEQUENCE, game: game() });
});

async function panel() {
  render(<QuestionsPanel token="t" />);
  await waitFor(() => expect(document.querySelector('.qtable__row')).not.toBeNull());
}

/** Titles listed in the reference table, ignoring the featured card above it. */
function tableTitles(): string[] {
  return [...document.querySelectorAll('.qtable__row .qtable__title strong')].map(
    (n) => n.textContent ?? '',
  );
}

describe('QuestionsPanel', () => {
  it('features the key for the question that is open right now', async () => {
    await panel();
    expect(document.querySelector('.qkey__code')?.textContent).toBe('Q-4417');
    expect(screen.getByText(/B1 Q1 · NOW OPEN/)).toBeInTheDocument();
  });

  it('says a premium has no key to read rather than showing one', async () => {
    useStore.setState({ game: game({ currentQuestionId: 'P1', slotIndex: 2 }) });
    await panel();
    expect(screen.getByText('No key to read')).toBeInTheDocument();
    expect(document.querySelector('.qkey__code')).toBeNull();
    // The premium's own key is never presented as something to announce.
    expect(screen.queryByText('PRM-6640')).toBeNull();
  });

  it('explains itself when no question is open', async () => {
    useStore.setState({ game: game({ currentQuestionId: null }) });
    await panel();
    expect(screen.getByText('No question is open.')).toBeInTheDocument();
  });

  it('shows only the drawn questions by default', async () => {
    await panel();
    expect(tableTitles()).toEqual(['Slice of Life', 'Algorithms Vault']);
  });

  it('can show the whole pool, drawn questions first', async () => {
    await panel();
    await userEvent.click(screen.getByRole('button', { name: 'Whole pool' }));
    expect(tableTitles()).toEqual([
      'Slice of Life',
      'Algorithms Vault',
      'Prototype Chain',
      'Recursion Depth',
    ]);
  });

  it('finds a question by its key', async () => {
    await panel();
    await userEvent.click(screen.getByRole('button', { name: 'Whole pool' }));
    await userEvent.type(screen.getByLabelText('Filter questions'), 'Q-7702');
    expect(tableTitles()).toEqual(['Recursion Depth']);
  });

  it('warns when keys are switched off, so the operator does not wait for one', async () => {
    useStore.setState({ config: { ...DEFAULT_CONFIG, requireAccessKey: false } });
    await panel();
    expect(screen.getByText(/Keys are currently switched off/)).toBeInTheDocument();
  });

  it('marks the open row so it is findable in a long table', async () => {
    await panel();
    const open = document.querySelector('.qtable__row[data-open="true"]');
    expect(open?.querySelector('.qtable__title strong')?.textContent).toBe('Slice of Life');
  });

  it('reports a failed load instead of showing an empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    render(<QuestionsPanel token="t" />);
    await waitFor(() =>
      expect(screen.getByText('Could not load the question keys.')).toBeInTheDocument(),
    );
  });
});
