export type PlaybackState = { index: number; status: 'paused' | 'playing' | 'ended' };
export type PlaybackAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; index: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'complete' }
  | { type: 'reset' };

export const initialPlayback: PlaybackState = { index: 0, status: 'paused' };

export function reducePlayback(
  state: PlaybackState,
  action: PlaybackAction,
  count: number,
): PlaybackState {
  if (count < 1) return initialPlayback;
  switch (action.type) {
    case 'play':
      return { index: state.status === 'ended' ? 0 : state.index, status: 'playing' };
    case 'pause':
      return { ...state, status: 'paused' };
    case 'seek':
      return {
        index: Math.max(0, Math.min(count - 1, Math.floor(action.index))),
        status: 'paused',
      };
    case 'previous':
      return { index: Math.max(0, state.index - 1), status: 'paused' };
    case 'next':
      return { index: Math.min(count - 1, state.index + 1), status: 'paused' };
    case 'complete':
      return state.status !== 'playing'
        ? state
        : state.index === count - 1
          ? { ...state, status: 'ended' }
          : { index: state.index + 1, status: 'playing' };
    case 'reset':
      return initialPlayback;
  }
}
