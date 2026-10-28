import type { CodeLesson } from '../core/lesson';
import type { RepositorySummary } from '../core/contracts';

export interface SavedEpisode {
  id: string;
  title: string;
  projectName: string;
  savedAt: string;
  durationSeconds: number;
  stepCount: number;
  audioStepCount: number;
}

export interface OpenedEpisode {
  entry: SavedEpisode;
  lesson: CodeLesson;
  repository: RepositorySummary;
}
