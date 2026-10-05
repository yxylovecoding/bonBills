import type { ClothesDayContext } from './types';
import { ClothesError } from './client';

type Submission = { context: ClothesDayContext; mutationId: string };
export interface ContextPending extends Submission { submitted?: Submission }
interface State { context: ClothesDayContext; dirty: boolean; saving: boolean; error: Error | null; conflict: string | null }

// One queue per account and day survives tab changes. Only one revision is in
// flight, and an uncertain request is retried verbatim before later edits.
export class ContextAutosave {
  private state: State;
  private listeners = new Set<() => void>();
  private mutationId: string;
  private initialRevision: string;
  private submitted?: Submission;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(initial: ClothesDayContext, pending: ContextPending | null,
    private send: (request: Submission) => Promise<ClothesDayContext>,
    private persist: (pending: ContextPending | null) => void) {
    this.state = { context: pending?.context ?? initial, dirty: !!pending, saving: false, error: null, conflict: null };
    this.initialRevision = initial.revision;
    this.mutationId = pending?.mutationId ?? crypto.randomUUID();
    this.submitted = pending?.submitted;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<State>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private store() {
    this.persist(this.state.dirty ? { context: this.state.context, mutationId: this.mutationId, submitted: this.submitted } : null);
  }
  accept(initial: ClothesDayContext) {
    if (initial.revision === this.initialRevision) return;
    this.initialRevision = initial.revision;
    if (!this.state.dirty && !this.state.saving && initial.revision !== this.state.context.revision) this.publish({ context: initial });
  }
  change(next: Partial<ClothesDayContext>) {
    this.mutationId = crypto.randomUUID();
    this.publish({ context: { ...this.state.context, ...next }, dirty: true, error: null });
    this.store(); this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.state.dirty && this.state.conflict === null) this.timer = setTimeout(() => { void this.flush(); }, 450);
  }
  resolveConflict() {
    if (this.state.conflict === null) return;
    const revision = this.state.conflict;
    this.submitted = undefined;
    this.publish({ conflict: null });
    this.change({ revision });
  }
  flush = async () => {
    clearTimeout(this.timer);
    if (!this.state.dirty || this.state.saving || this.state.conflict !== null) return;
    if (this.state.context.indoorTemperature != null && (!Number.isFinite(this.state.context.indoorTemperature) || Math.abs(this.state.context.indoorTemperature) > 60)) return;
    if (this.state.context.manualWeather && (!Number.isFinite(this.state.context.manualWeather.temperature)
      || Math.abs(this.state.context.manualWeather.temperature) > 60)) return;
    this.publish({ saving: true, error: null });
    this.submitted ??= { context: this.state.context, mutationId: this.mutationId };
    const submitted = this.submitted;
    this.store();
    try {
      const value = await this.send(submitted);
      this.submitted = undefined;
      const unchanged = submitted.mutationId === this.mutationId;
      this.publish({ context: unchanged ? value : { ...this.state.context, revision: value.revision }, dirty: !unchanged, saving: false });
      this.store();
      if (!unchanged) void this.flush();
    } catch (cause) {
      const conflict = cause instanceof ClothesError && cause.status === 409 ? (cause.current as ClothesDayContext | null)?.revision ?? '' : null;
      this.publish({ saving: false, error: cause instanceof Error ? cause : new Error('保存失败，请重试'), conflict });
      this.store();
    }
  };
}
