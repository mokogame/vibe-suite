export type QueueStats = {
  pending: number;
  active: number;
  concurrency: number;
};

type Task = {
  id: string;
  run: () => Promise<void>;
};

export class RunQueue {
  private readonly pending: Task[] = [];
  private active = 0;

  constructor(private readonly concurrency = 2) {}

  enqueue(id: string, run: () => Promise<void>): void {
    this.pending.push({ id, run });
    this.drain();
  }

  stats(): QueueStats {
    return {
      pending: this.pending.length,
      active: this.active,
      concurrency: this.concurrency
    };
  }

  clearPending(): number {
    const cleared = this.pending.length;
    this.pending.length = 0;
    return cleared;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) return;
      this.active += 1;
      void task.run().finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}
