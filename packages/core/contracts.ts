import type { SpeechClip, SpeechProgress, SpeechRequest, SpeechStatus } from '../speech/contract';
import type {
  AgentStatus,
  GenerationProgress,
  GenerationRequest,
  GenerationResult,
} from '../agents/contract';
import type { OpenedEpisode, SavedEpisode } from '../storage/episode-contract';
import type { CodeLesson } from './lesson';

export interface RepositorySummary {
  name: string;
  files: string[];
  truncated: boolean;
  sourceSnapshot?: boolean;
  canGenerate?: boolean;
}

export interface DesktopBridge {
  openRepository(): Promise<RepositorySummary | null>;
  readSource(path: string): Promise<string>;
  readAudio(path: string): Promise<string>;
  openLesson(): Promise<string | null>;
  listEpisodes?(): Promise<SavedEpisode[]>;
  openEpisode?(id: string): Promise<OpenedEpisode>;
  restoreEpisode?(): Promise<OpenedEpisode | null>;
  saveEpisode?(lesson: CodeLesson): Promise<SavedEpisode>;
  saveEpisodeNarration?(id: string, clips: SpeechClip[]): Promise<SavedEpisode>;
  listAgents(): Promise<AgentStatus[]>;
  generationFiles(): Promise<string[]>;
  generateLesson(request: GenerationRequest): Promise<GenerationResult>;
  cancelLessonGeneration(): Promise<void>;
  onGenerationProgress(listener: (progress: GenerationProgress) => void): () => void;
  speechStatus(): Promise<SpeechStatus>;
  prepareSpeech(): Promise<SpeechStatus>;
  generateSpeech(request: SpeechRequest): Promise<SpeechClip[]>;
  cancelSpeech(): Promise<void>;
  readSpeechAudio(cacheKey: string): Promise<string>;
  onSpeechProgress(listener: (progress: SpeechProgress) => void): () => void;
}

// Adapters produce data; they never execute lesson content or control the player.
export interface AgentAdapter {
  id: string;
  detect(): Promise<{ available: boolean; version?: string }>;
  generateLesson(input: {
    repositoryRoot: string;
    objective: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface SpeechProvider {
  id: string;
  synthesize(input: {
    text: string;
    voice: string;
    signal: AbortSignal;
  }): Promise<{ audio: Uint8Array; mimeType: string; durationSeconds: number }>;
}
