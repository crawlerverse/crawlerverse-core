/**
 * React Hooks
 *
 * Custom hooks for game state management.
 */

export {
  useGame,
  type CrawlerControl,
  type CrawlerConfig,
  type DispatchResult,
  type GameStatus,
  type StepMode,
  type Thought,
  type UseGameOptions,
} from './useGame';

export {
  CharacterRosterProvider,
  useCharacterRoster,
  type CharacterRosterContextValue,
  type CharacterRosterProviderProps,
} from './useCharacterRoster';

export { useDiceRoll } from './useDiceRoll';

export {
  useAutoCamera,
  type UseAutoCameraOptions,
  type UseAutoCameraResult,
  type CameraFocus,
} from './useAutoCamera';