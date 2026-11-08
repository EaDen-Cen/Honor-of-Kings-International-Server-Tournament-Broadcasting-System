import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { fileURLToPath } from 'node:url';
import { registerTestArtifact } from '../server/storageMaintenance.js';
/** Only actual Playwright attachment paths, never every old file in a directory. */
export default class ArtifactReporter implements Reporter {
  private tasks: Promise<void>[] = [];
  onTestEnd(_test: TestCase, result: TestResult) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    for (const item of result.attachments)
      if (item.path) this.tasks.push(registerTestArtifact(root, item.path).catch(() => {}));
  }
  async onEnd() {
    await Promise.all(this.tasks);
  }
}
