export const windowKey = window => `${window.pid}:${window.start}:${window.handle}`;

export class RecoveryController {
  constructor({ bridge, emit = () => {}, now = Date.now, automatic = true }) {
    this.bridge = bridge;
    this.emit = emit;
    this.now = now;
    this.automatic = automatic;
    this.visible = new Map();
    this.lastAttempt = -Infinity;
    this.busy = false;
    this.stopped = false;
    this.halted = false;
    this.state = { phase: 'starting', automatic, candidates: 0, lastReset: null, error: null };
  }
  status() { return { ...this.state, automatic: this.automatic }; }
  publish(change) {
    this.state = { ...this.state, ...change };
    if (!this.stopped) this.emit(this.status());
    return this.status();
  }
  setAutomatic(value) {
    if (typeof value !== 'boolean') throw new Error('invalid_automatic');
    this.automatic = value;
    return this.publish({ phase: value ? (this.halted ? 'error' : 'watching') : 'paused' });
  }
  async tick(manual = false) {
    if (this.stopped) return this.status();
    if (this.busy) return { ...this.status(), notice: 'busy' };
    if (!manual && this.halted) return this.status();
    this.busy = true;
    try {
      const snapshot = await this.bridge.scan();
      if (this.stopped) return this.status();
      if (!snapshot.ok || !Array.isArray(snapshot.windows)) throw new Error(snapshot.code || 'invalid_snapshot');
      const now = this.now();
      const windows = snapshot.windows;
      const current = new Map();
      for (const window of windows) {
        const key = windowKey(window);
        const geometry = `${window.x}:${window.y}:${window.width}:${window.height}`;
        const prior = this.visible.get(key);
        current.set(key, prior?.geometry === geometry ? prior : {
          geometry, since: now, completed: prior?.completed ?? false,
        });
      }
      this.visible = current;
      const base = { candidates: windows.length, version: windows[0]?.version ?? null, error: null };
      if (!snapshot.desktopAvailable) return this.publish({ ...base, phase: 'desktop_unavailable' });
      if (windows.length === 0) return this.publish({ ...base, phase: 'waiting' });
      if (windows.length !== 1) return this.publish({ ...base, phase: 'ambiguous' });
      if (snapshot.buttonDown) return this.publish({ ...base, phase: 'input_busy' });
      if (!manual && !this.automatic) return this.publish({ ...base, phase: 'paused' });
      const target = windows[0];
      const record = current.get(windowKey(target));
      if (!manual && record.completed) return this.publish({ ...base, phase: 'watching' });
      if (now - record.since < 2000 || now - this.lastAttempt < (manual ? 10000 : 30000)) {
        return this.publish({ ...base, phase: 'settling' });
      }
      this.lastAttempt = now;
      this.publish({ ...base, phase: 'repairing' });
      const result = await this.bridge.repair(target);
      if (this.stopped) return this.status();
      if (result.code === 'input_busy' || result.code === 'window_changed' || result.code === 'ambiguous_window' ||
          (result.code === 'reset_interrupted' && result.restoredExactly)) {
        this.lastAttempt = -Infinity;
        return this.publish({ ...base, phase: 'settling' });
      }
      if (!result.ok || !result.restoredExactly) throw new Error(result.code || 'restore_not_verified');
      record.completed = true;
      this.halted = false;
      return this.publish({ ...base, phase: this.automatic ? 'watching' : 'paused', lastReset: {
        at: this.now(), reason: manual ? 'manual' : 'new-window', original: result.original,
        temporary: result.temporary, restoredExactly: true,
      } });
    } catch (error) {
      if (this.stopped) return this.status();
      this.halted = true; // Unknown outcome must not trigger an automatic retry loop.
      return this.publish({ phase: 'error', error: String(error.message || error).slice(0,400) });
    } finally { this.busy = false; }
  }
  async stop() {
    this.stopped = true;
    this.state = { ...this.state, phase: 'stopped' };
    await this.bridge.stop();
  }
}
