import fs from 'node:fs/promises';
import path from 'node:path';
import { NativeBridge } from './bridge.js';
import { RecoveryController } from './controller.js';

export async function activate({ rpc, packageDirectory, dataDirectory, signal }) {
  if (process.platform !== 'win32') {
    rpc.handle('status', () => ({ phase: 'unsupported', automatic: false, candidates: 0 }));
    return;
  }
  const preferencesPath = path.join(dataDirectory, 'preferences.json');
  let automatic = true;
  try {
    const preferences = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
    if (typeof preferences.automatic === 'boolean') automatic = preferences.automatic;
  } catch (error) {
    if (error.code !== 'ENOENT') automatic = false; // Corrupt/unreadable preferences must not enable changes.
  }
  if (signal.aborted) return;
  const controller = new RecoveryController({
    bridge: new NativeBridge(packageDirectory), automatic,
    emit: state => { if (!signal.aborted) rpc.emit('status', state); },
  });
  let stopped = false, stopPromise;
  const timer = setInterval(() => { void controller.tick(); }, 2000);
  timer.unref?.();
  const stop = () => {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
      signal.removeEventListener('abort', stop);
      stopPromise = controller.stop();
    }
    return stopPromise;
  };
  signal.addEventListener('abort', stop, { once: true });
  rpc.handle('status', () => controller.status());
  rpc.handle('repair', () => controller.tick(true));
  let preferenceWrite = Promise.resolve();
  rpc.handle('set-automatic', payload => {
    if (!payload || typeof payload.enabled !== 'boolean') throw new Error('enabled must be boolean');
    const value = payload.enabled;
    preferenceWrite = preferenceWrite.catch(() => {}).then(async () => {
      if (stopped) throw new Error('stopped');
      await fs.mkdir(dataDirectory, { recursive: true });
      const temporary = preferencesPath + '.tmp';
      await fs.writeFile(temporary, JSON.stringify({ automatic: value }) + '\n', 'utf8');
      await fs.rename(temporary, preferencesPath);
      if (stopped) throw new Error('stopped');
      return controller.setAutomatic(value);
    });
    return preferenceWrite;
  });
  void controller.tick();
  return stop;
}
