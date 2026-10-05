import { RuntimeFailure, requireFact } from './validation';

export class RuntimeDeadline {
  private readonly started = performance.now();
  private expired = false;
  constructor(
    readonly signal?: AbortSignal,
    private readonly milliseconds = 10000,
  ) {}
  remaining() {
    const n = Math.floor(this.milliseconds - (performance.now() - this.started));
    requireFact(!this.expired && !this.signal?.aborted && n > 0, 'CANCELLED');
    return n;
  }
  assert() {
    this.remaining();
  }
  async wait<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          const cancel = () => {
            this.expired = true;
            reject(new RuntimeFailure('CANCELLED'));
          };
          abort = cancel;
          this.signal?.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(cancel, this.remaining());
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) this.signal?.removeEventListener('abort', abort);
    }
  }
}
/** Permit follows the actual work promise, not the caller's deadline race. No queue. */
export class RetainedAdmission {
  private occupied = 0;
  run<T>(work: (deadline: RuntimeDeadline) => Promise<T>, signal?: AbortSignal): Promise<T> {
    requireFact(this.occupied < 2, 'BUDGET_EXCEEDED');
    const deadline = new RuntimeDeadline(signal);
    deadline.assert();
    this.occupied++;
    const actual = Promise.resolve()
      .then(() => {
        deadline.assert();
        return work(deadline);
      })
      .finally(() => {
        this.occupied--;
      });
    return deadline.wait(actual);
  }
}
export const runtimeAdmission = new RetainedAdmission();
