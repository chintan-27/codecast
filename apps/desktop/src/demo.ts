import checkout from '../../../tests/fixtures/sample/src/checkout.ts?raw';
import server from '../../../tests/fixtures/sample/src/server.ts?raw';
import orders from '../../../tests/fixtures/sample/src/orders.ts?raw';
import lessonJSON from '../../../tests/fixtures/sample/codecast.lesson.json';
import { lessonSchema } from '../../../packages/core/lesson';

export const demoSources: Record<string, string> = {
  'src/checkout.ts': checkout,
  'src/server.ts': server,
  'src/orders.ts': orders,
};

export const demoLesson = lessonSchema.parse(lessonJSON);
