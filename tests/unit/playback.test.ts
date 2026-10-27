import { describe, expect, it } from 'vitest';
import { initialPlayback, reducePlayback } from '../../packages/playback/state';

describe('playback transitions', () => {
  it('advances only when playing, and stops after the last step', () => {
    expect(reducePlayback(initialPlayback, { type: 'complete' }, 2)).toEqual(initialPlayback);
    let state = reducePlayback(initialPlayback, { type: 'play' }, 2);
    state = reducePlayback(state, { type: 'complete' }, 2);
    expect(state).toEqual({ index: 1, status: 'playing' });
    state = reducePlayback(state, { type: 'complete' }, 2);
    expect(state).toEqual({ index: 1, status: 'ended' });
    expect(reducePlayback(state, { type: 'play' }, 2)).toEqual({ index: 0, status: 'playing' });
  });

  it('pauses on seek and bounds navigation to the lesson', () => {
    const playing = { index: 1, status: 'playing' as const };
    expect(reducePlayback(playing, { type: 'seek', index: 999 }, 3)).toEqual({
      index: 2,
      status: 'paused',
    });
    expect(reducePlayback(playing, { type: 'seek', index: -2 }, 3)).toEqual(initialPlayback);
    expect(reducePlayback(initialPlayback, { type: 'previous' }, 3)).toEqual(initialPlayback);
    expect(reducePlayback({ index: 2, status: 'paused' }, { type: 'next' }, 3).index).toBe(2);
  });

  it('ignores late audio completion after pausing', () => {
    const state = reducePlayback({ index: 1, status: 'playing' }, { type: 'pause' }, 3);
    expect(reducePlayback(state, { type: 'complete' }, 3)).toEqual(state);
    expect(reducePlayback(state, { type: 'reset' }, 3)).toEqual(initialPlayback);
  });
});
