import { randomBytes } from 'node:crypto';
import { Problem } from './model.mjs';

export const DOCUMENT_KEY = 'application-v1';

// Persist the whole prototype state with compare-and-swap. Every write is
// conditional on the strongly consistent version we read. A lost race reruns
// the operation against fresh data, including its business-rule checks.
export class Repository {
  constructor(store, initial) { this.store = store; this.initial = initial; }
  async read() {
    for (let i = 0; i < 10; i++) {
      const entry = await this.store.getWithMetadata(DOCUMENT_KEY, { type: 'json', consistency: 'strong' });
      if (entry) {
        if (entry.data?.schema !== 1) throw new Problem('The saved data version is unsupported. Contact the coordinator.', 503);
        return entry;
      }
      const data = this.initial();
      data.revision = randomBytes(12).toString('hex');
      await this.store.setJSON(DOCUMENT_KEY, data, { onlyIfNew: true });
    }
    throw new Problem('The swap board is busy. Please try again.', 503);
  }
  async mutate(operation) {
    for (let i = 0; i < 12; i++) {
      const entry = await this.read();
      const document = structuredClone(entry.data);
      const result = operation(document);
      if (result instanceof Promise) throw new Error('Repository operations must not perform asynchronous side effects.');
      document.revision = randomBytes(12).toString('hex');
      if (Buffer.byteLength(JSON.stringify(document)) > 8_000_000) throw new Problem('The prototype store has reached its capacity. Contact the coordinator.', 503);
      const saved = await this.store.setJSON(DOCUMENT_KEY, document, { onlyIfMatch: entry.etag });
      if (saved.modified) return result;
      await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 25));
    }
    throw new Problem('Several students are updating the board. Please try again.', 503);
  }
}
