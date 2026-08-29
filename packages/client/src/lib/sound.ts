/**
 * Sound (spec section 44).
 *
 * Every cue is SYNTHESISED with the Web Audio API rather than loaded from an
 * audio file. That is a deliberate offline decision: no downloads, no CDN, no
 * licence questions, nothing to bundle, and the whole system is a few hundred
 * bytes. Sound is never required to understand the UI - it only reinforces it.
 */

export type Cue =
  | 'bid'
  | 'outbid'
  | 'hammer'
  | 'auction_start'
  | 'correct'
  | 'wrong'
  | 'timeout'
  | 'premium_unlock'
  | 'reclaim'
  | 'rank_up'
  | 'fail'
  | 'final'
  | 'tick';

interface Note {
  freq: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

const CUES: Record<Cue, Note[]> = {
  bid: [{ freq: 660, start: 0, duration: 0.07, type: 'triangle', gain: 0.16 }],
  outbid: [
    { freq: 420, start: 0, duration: 0.09, type: 'sawtooth', gain: 0.13 },
    { freq: 300, start: 0.08, duration: 0.13, type: 'sawtooth', gain: 0.12 },
  ],
  hammer: [
    { freq: 180, start: 0, duration: 0.12, type: 'square', gain: 0.18 },
    { freq: 120, start: 0.1, duration: 0.22, type: 'sine', gain: 0.16 },
  ],
  auction_start: [
    { freq: 523, start: 0, duration: 0.1, type: 'triangle', gain: 0.13 },
    { freq: 784, start: 0.09, duration: 0.16, type: 'triangle', gain: 0.13 },
  ],
  correct: [
    { freq: 587, start: 0, duration: 0.09, type: 'sine', gain: 0.16 },
    { freq: 880, start: 0.08, duration: 0.11, type: 'sine', gain: 0.16 },
    { freq: 1175, start: 0.17, duration: 0.2, type: 'sine', gain: 0.14 },
  ],
  wrong: [
    { freq: 233, start: 0, duration: 0.14, type: 'sawtooth', gain: 0.12 },
    { freq: 175, start: 0.12, duration: 0.24, type: 'sawtooth', gain: 0.11 },
  ],
  timeout: [
    { freq: 392, start: 0, duration: 0.1, type: 'square', gain: 0.1 },
    { freq: 330, start: 0.11, duration: 0.1, type: 'square', gain: 0.1 },
    { freq: 262, start: 0.22, duration: 0.26, type: 'square', gain: 0.1 },
  ],
  premium_unlock: [
    { freq: 440, start: 0, duration: 0.1, type: 'triangle', gain: 0.14 },
    { freq: 659, start: 0.09, duration: 0.1, type: 'triangle', gain: 0.14 },
    { freq: 880, start: 0.18, duration: 0.12, type: 'triangle', gain: 0.15 },
    { freq: 1319, start: 0.28, duration: 0.3, type: 'sine', gain: 0.14 },
  ],
  reclaim: [
    { freq: 740, start: 0, duration: 0.11, type: 'square', gain: 0.12 },
    { freq: 740, start: 0.2, duration: 0.11, type: 'square', gain: 0.12 },
  ],
  rank_up: [
    { freq: 784, start: 0, duration: 0.07, type: 'sine', gain: 0.11 },
    { freq: 1047, start: 0.06, duration: 0.12, type: 'sine', gain: 0.11 },
  ],
  fail: [
    { freq: 196, start: 0, duration: 0.18, type: 'sawtooth', gain: 0.13 },
    { freq: 147, start: 0.16, duration: 0.3, type: 'sawtooth', gain: 0.12 },
  ],
  final: [
    { freq: 262, start: 0, duration: 0.16, type: 'triangle', gain: 0.14 },
    { freq: 392, start: 0.15, duration: 0.16, type: 'triangle', gain: 0.14 },
    { freq: 523, start: 0.3, duration: 0.16, type: 'triangle', gain: 0.15 },
    { freq: 784, start: 0.45, duration: 0.45, type: 'sine', gain: 0.16 },
  ],
  tick: [{ freq: 1200, start: 0, duration: 0.03, type: 'square', gain: 0.06 }],
};

class SoundSystem {
  private context: AudioContext | null = null;
  private enabled = true;
  private muted = false;
  private master = 0.6;

  /** Browsers require a user gesture before audio can start. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
    } catch {
      this.context = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem('cm.muted', muted ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  loadPreference(): void {
    try {
      this.muted = localStorage.getItem('cm.muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  setVolume(value: number): void {
    this.master = Math.max(0, Math.min(1, value));
  }

  play(cue: Cue): void {
    if (!this.enabled || this.muted) return;
    if (!this.context) this.unlock();
    const ctx = this.context;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const notes = CUES[cue];
    if (!notes) return;
    const now = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      const peak = (note.gain ?? 0.14) * this.master;
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(peak, now + note.start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.duration + 0.02);
    }
  }
}

export const sound = new SoundSystem();
