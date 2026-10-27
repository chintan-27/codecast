import { z } from 'zod';

export const speechVoices = [
  { id: 'af_heart', name: 'Heart', accent: 'American English' },
  { id: 'af_bella', name: 'Bella', accent: 'American English' },
  { id: 'am_michael', name: 'Michael', accent: 'American English' },
  { id: 'bf_emma', name: 'Emma', accent: 'British English' },
] as const;
export const voiceSchema = z.enum(['af_heart', 'af_bella', 'am_michael', 'bf_emma']);
export type SpeechVoice = z.infer<typeof voiceSchema>;
export const speechRequestSchema = z
  .object({
    voice: voiceSchema,
    steps: z
      .array(
        z.object({ id: z.string().min(1).max(100), text: z.string().min(1).max(10000) }).strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.steps.reduce((total, step) => total + step.text.length, 0) > 200000) {
      context.addIssue({
        code: 'custom',
        message: 'Narration is limited to 200,000 characters per job.',
      });
    }
    if (new Set(request.steps.map((step) => step.id)).size !== request.steps.length) {
      context.addIssue({ code: 'custom', message: 'Narration step IDs must be unique.' });
    }
  });
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export const speechClipSchema = z
  .object({
    stepId: z.string(),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    durationSeconds: z.number().positive().max(600),
    cached: z.boolean(),
  })
  .strict();
export type SpeechClip = z.infer<typeof speechClipSchema>;
export interface SpeechStatus {
  available: boolean;
  ready: boolean;
  message: string;
}
export type SpeechProgress = {
  phase: 'setup' | 'loading' | 'generating';
  completed: number;
  total: number;
  message: string;
};
