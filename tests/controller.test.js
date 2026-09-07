import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryController } from '../src/controller.js';

const pet = { pid: 101, start: '1000', handle: '2000',
  x: 100, y: 0, width: 400, height: 600, version: 'test' };
function setup(options = {}) {
  let time = 0;
  const snapshot = { ok: true, desktopAvailable: true, buttonDown: false, windows: [{ ...pet }] };
  const repairs = [];
  const bridge = {
    scan: async () => snapshot,
    repair: async target => { repairs.push(target); return { ok: true, restoredExactly: true,
      original: '0x000800A8', temporary: '0x000000A8' }; },
    stop: async () => {},
  };
  const controller = new RecoveryController({ bridge, now: () => time, ...options });
  return { controller, snapshot, bridge, repairs, advance: value => { time += value; } };
}

test('one reset after stable appearance; moving a healthy window does not reset it', async () => {
  const f = setup();
  assert.equal((await f.controller.tick()).phase, 'settling');
  f.advance(2000);
  await f.controller.tick();
  assert.equal(f.repairs.length, 1);
  f.snapshot.windows[0].x += 10;
  f.advance(60000);
  await f.controller.tick();
  assert.equal(f.repairs.length, 1);
  assert.equal(f.controller.status().lastReset.restoredExactly, true);
});

test('moving new window must settle before reset', async () => {
  const f = setup();
  await f.controller.tick();
  f.advance(2000);
  f.snapshot.windows[0].x += 10;
  await f.controller.tick();
  assert.equal(f.repairs.length, 0);
  f.advance(2000); await f.controller.tick();
  assert.equal(f.repairs.length, 1);
});

for (const [name, mutate, phase] of [
  ['multiple overlays', s => { s.windows.push({ ...pet, handle: '2' }); }, 'ambiguous'],
  ['mouse held', s => { s.buttonDown = true; }, 'input_busy'],
  ['locked desktop', s => { s.desktopAvailable = false; }, 'desktop_unavailable'],
  ['missing overlay', s => { s.windows = []; }, 'waiting'],
]) test(name + ' prevents changes', async () => {
  const f = setup(); mutate(f.snapshot);
  await f.controller.tick(); f.advance(60000);
  assert.equal((await f.controller.tick()).phase, phase);
  assert.equal(f.repairs.length, 0);
});

test('hidden/reopened window resets again after cooldown', async () => {
  const f = setup();
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  f.snapshot.windows = []; await f.controller.tick();
  f.snapshot.windows = [{ ...pet }]; await f.controller.tick();
  f.advance(2000); await f.controller.tick();
  assert.equal(f.repairs.length, 1);
  f.advance(28000); await f.controller.tick();
  assert.equal(f.repairs.length, 2);
});

test('PID and HWND reuse with a different process start is a new target', async () => {
  const f = setup();
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  f.snapshot.windows[0].start = '1001';
  f.advance(30000); await f.controller.tick();
  f.advance(2000); await f.controller.tick();
  assert.equal(f.repairs.length, 2);
});

test('manual recovery works while automatic is paused and has a cooldown', async () => {
  const f = setup({ automatic: false });
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  assert.equal(f.repairs.length, 0);
  await f.controller.tick(true);
  assert.equal(f.repairs.length, 1);
  await f.controller.tick(true);
  assert.equal(f.repairs.length, 1);
  f.advance(10000); await f.controller.tick(true);
  assert.equal(f.repairs.length, 2);
});

test('unknown outcome halts automatic retries; successful manual retry clears halt', async () => {
  const f = setup();
  const repair = f.bridge.repair;
  f.bridge.repair = async () => { throw new Error('native_request_timeout'); };
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  assert.equal(f.controller.status().phase, 'error');
  f.bridge.repair = repair; f.advance(60000); await f.controller.tick();
  assert.equal(f.repairs.length, 0);
  await f.controller.tick(true);
  assert.equal(f.repairs.length, 1);
  assert.equal(f.controller.halted, false);
});

test('unverified restore is never reported as success', async () => {
  const f = setup();
  f.bridge.repair = async () => ({ ok: true, restoredExactly: false });
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  assert.equal(f.controller.status().phase, 'error');
  assert.equal(f.controller.status().lastReset, null);
});

test('native target change can retry without treating uncertain repair as success', async () => {
  const f = setup(); const repair = f.bridge.repair;
  f.bridge.repair = async () => ({ ok: false, code: 'window_changed' });
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  assert.equal(f.controller.halted, false);
  f.bridge.repair = repair;
  await f.controller.tick();
  assert.equal(f.repairs.length, 1);
});

test('stop during scan prevents reset and concurrent requests are serialized', async () => {
  const f = setup();
  await f.controller.tick(); f.advance(2000);
  let release;
  f.bridge.scan = () => new Promise(resolve => { release = resolve; });
  const pending = f.controller.tick();
  assert.equal((await f.controller.tick(true)).notice, 'busy');
  await f.controller.stop();
  release(f.snapshot); await pending;
  assert.equal(f.repairs.length, 0);
  assert.equal(f.controller.status().phase, 'stopped');
});

test('cleanup rejection preserves stopped status instead of reporting a new error', async () => {
  const f = setup();
  let reject;
  f.bridge.scan = () => new Promise((resolve, fail) => { reject = fail; });
  f.bridge.stop = async () => { reject(new Error('stopped')); };
  const pending = f.controller.tick();
  await f.controller.stop(); await pending;
  assert.equal(f.controller.status().phase, 'stopped');
});

test('interrupted reset with verified restore remains eligible for a later retry', async () => {
  const f = setup();
  f.bridge.repair = async () => ({ ok: false, code: 'reset_interrupted', restoredExactly: true });
  await f.controller.tick(); f.advance(2000); await f.controller.tick();
  assert.equal(f.controller.status().lastReset, null);
  assert.equal(f.controller.halted, false);
});
