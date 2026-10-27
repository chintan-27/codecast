import { readFileSync, writeFileSync, writeSync } from 'node:fs';
// Flush protocol events before exiting, including under restricted test runners.
const emit = (value) => writeSync(1, JSON.stringify(value) + '\n');

const [agent, behavior, source, ...args] = process.argv.slice(2);
if (args.includes('--version')) {
  writeSync(1, `${agent} 1.2.3\n`);
  process.exit(0);
}
const prompt = readFileSync(0, 'utf8');
if (!prompt.includes('SOURCE SNAPSHOT') || !prompt.includes('quantity')) process.exit(2);
if (args.join(' ').includes('SOURCE SNAPSHOT')) process.exit(3);
const draft = JSON.parse(readFileSync(new URL('./agent-draft.json', import.meta.url), 'utf8'));
if (behavior === 'stream-error') {
  emit({ type: 'error', error: { message: 'private provider diagnostics' } });
  setInterval(() => {}, 1000);
} else if (behavior === 'wait') {
  emit(
    agent === 'codex'
      ? { type: 'turn.started' }
      : agent === 'claude'
        ? { type: 'system', subtype: 'init' }
        : { type: 'step_start' },
  );
  setInterval(() => {}, 1000);
} else {
  if (behavior === 'stale') writeFileSync(source, 'changed during generation');
  if (behavior === 'foreign') draft.scenes[0].steps[0].file = '../outside.ts';
  if (behavior === 'auth') {
    writeSync(2, 'Unauthorized: private-secret-not-for-ui\n');
    process.exit(1);
  }
  if (agent === 'codex') {
    if (
      !args.includes('read-only') ||
      !args.includes('--ignore-user-config') ||
      args.includes('--dangerously-bypass-approvals-and-sandbox')
    )
      process.exit(4);
    writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(draft));
    emit({ type: 'turn.completed' });
  } else if (agent === 'claude') {
    if (
      args[args.indexOf('--tools') + 1] !== '' ||
      !args.includes('--safe-mode') ||
      !args.includes('--strict-mcp-config')
    )
      process.exit(4);
    emit({ type: 'result', subtype: 'success', structured_output: draft });
  } else {
    const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
    if (config.permission['*'] !== 'deny' || config.agent.codecast_lesson.tools['*'] !== false)
      process.exit(4);
    emit({ type: 'text', part: { text: JSON.stringify(draft) } });
    emit({ type: 'step_finish' });
  }
}
