import path from 'node:path';
import { LessonGenerationService } from '../packages/agents/service';
import { agentIdSchema } from '../packages/agents/contract';
import { RepositoryAccess } from '../packages/repository/access';
import { flattenSteps } from '../packages/core/lesson';

async function main() {
  const agent = agentIdSchema.parse(process.argv[2] ?? 'codex');
  const service = new LessonGenerationService({
    dataDirectory: path.resolve('test-results/live-generation'),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => service.cancel());
  const statuses = await service.detect();
  if (!statuses.find((item) => item.id === agent)?.available)
    throw new Error(`${agent} is not installed. Install and sign in to its CLI first.`);
  const repository = await RepositoryAccess.open('tests/fixtures/sample');
  const result = await service.generate(
    repository,
    {
      agent,
      model: process.argv[3] ?? '',
      depth: 'overview',
      objective:
        'Trace checkout from the empty-cart check through quantity validation to saving an order and returning its identifier. Explain the in-memory storage limitation.',
      files: ['src/checkout.ts', 'src/server.ts', 'src/orders.ts'],
    },
    (event) => console.log(event.message),
  );
  console.log(
    JSON.stringify({
      title: result.lesson.title,
      agent: result.agent,
      steps: flattenSteps(result.lesson).length,
      files: result.context.files,
    }),
  );
}
main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : 'Live generation failed.');
  process.exitCode = 1;
});
