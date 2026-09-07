import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NativeBridge } from '../src/bridge.js';

function setup() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { throw new Error('must not kill helper during style restoration'); };
  let launch;
  const bridge = new NativeBridge('C:/example with spaces/package', (...args) => { launch = args; return child; });
  return { child, bridge, launch, reply: value => child.stdout.write(JSON.stringify(value) + '\n') };
}

test('launch is hidden, shell-free, and sends identity as structured protocol', async () => {
  const f = setup();
  assert.equal(f.launch[2].windowsHide, true);
  assert.equal(f.launch[2].shell, false);
  assert.ok(f.launch[1].includes('C:\\example with spaces\\package\\native\\agent.ps1') ||
    f.launch[1].includes('C:/example with spaces/package/native/agent.ps1'));
  const wire = [];
  f.child.stdin.on('data', data => wire.push(data.toString()));
  f.reply({ type: 'ready' });
  const pending = f.bridge.scan();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wire.join(''), 'scan:1\n');
  f.reply({ id: 1, ok: true, windows: [] });
  assert.equal((await pending).ok, true);
  const stop = f.bridge.stop();
  assert.equal(f.child.stdin.writableEnded, true);
  f.child.emit('close', 0); await stop;
});

test('stop rejects pending reset and closes stdin without killing native helper', async () => {
  const f = setup(); f.reply({ type: 'ready' });
  const pending = f.bridge.repair({ pid: 1, start: '123', handle: '456' });
  const rejection = assert.rejects(pending, /stopped/);
  await new Promise(resolve => setImmediate(resolve));
  const stop = f.bridge.stop();
  await rejection;
  assert.equal(f.child.stdin.writableEnded, true);
  f.child.emit('close', 0); await stop;
});

test('malformed identities never enter the protocol', async () => {
  const f = setup(); f.reply({ type: 'ready' });
  assert.throws(() => f.bridge.repair({ pid: 1, start: '123\nquit', handle: '456' }), /invalid_window_identity/);
  const stop = f.bridge.stop(); f.child.emit('close', 0); await stop;
});

test('unexpected native exit rejects pending requests', async () => {
  const f = setup(); f.reply({ type: 'ready' });
  const pending = f.bridge.scan();
  const rejection = assert.rejects(pending, /native_exit_1/);
  await new Promise(resolve => setImmediate(resolve));
  f.child.emit('close', 1); await rejection;
  await f.bridge.stop();
});
