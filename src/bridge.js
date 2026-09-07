import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

export class NativeBridge {
  constructor(packageDirectory, spawnProcess = spawn) {
    this.sequence = 0;
    this.pending = new Map();
    this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.child = spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File',
      path.join(packageDirectory, 'native', 'agent.ps1'), '-ParentProcessId', String(process.pid)],
    { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', error => this.fail(error));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'ready') { clearTimeout(this.startTimer); this.resolveReady(); return; }
      if (message.type === 'fatal') { this.fail(new Error(message.code)); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      request.resolve(message);
    });
    this.stderr = '';
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-1200); });
    this.child.once('error', error => this.fail(error));
    this.exited = new Promise(resolve => this.child.once('close', code => {
      this.fail(new Error(`native_exit_${code ?? 'unknown'}${this.stderr ? ': ' + this.stderr : ''}`));
      resolve();
    }));
    this.startTimer = setTimeout(() => this.fail(new Error('native_start_timeout')), 20000);
    this.startTimer.unref?.();
  }
  fail(error) {
    clearTimeout(this.startTimer);
    this.closed = true;
    this.rejectReady(error);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    // Never kill during the 3-second reset: EOF asks the helper to restore in finally.
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) this.child.stdin.end();
  }
  async request(command) {
    await this.ready;
    if (this.closed) throw new Error('native_closed');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('native_request_timeout')), 15000);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(command(id) + '\n', error => { if (error) this.fail(error); });
    });
  }
  scan() { return this.request(id => `scan:${id}`); }
  repair(window) {
    if (!Number.isInteger(window.pid) || !/^\d+$/.test(window.start) || !/^\d+$/.test(window.handle)) throw new Error('invalid_window_identity');
    return this.request(id => `repair:${id}:${window.pid}:${window.start}:${window.handle}`);
  }
  async stop() {
    this.fail(new Error('stopped'));
    await this.exited;
    this.lines.close();
  }
}
