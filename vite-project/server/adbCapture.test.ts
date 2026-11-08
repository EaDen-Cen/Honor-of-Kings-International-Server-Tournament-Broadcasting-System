import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AdbCapture, localAdbSerial, parseLdInstances } from './adbCapture.js';

test('LDPlayer discovery excludes stopped instances and arbitrary remote/USB serials', () => {
  assert.deepEqual(parseLdInstances('0,LD,1,2,1,3,4,1920,1080\n1,Stopped,0,0,0,-1,-1'), [
    { index: 0, name: 'LD' },
  ]);
  for (const serial of ['phone-id', '192.168.1.1:5555', '; reboot', 'emulator-5554 shell'])
    assert.equal(localAdbSerial(serial), false);
  assert.equal(localAdbSerial('emulator-5554'), true);
});
test('capture only uses discovered instance and bounds concurrent work without a queue', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hok-adb-'));
  try {
    const adb = join(dir, 'adb.exe');
    writeFileSync(adb, '');
    writeFileSync(join(dir, 'ldconsole.exe'), '');
    const png = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const calls: string[][] = [];
    let release: () => void = () => {};
    const capture = new AdbCapture(async (_file, args) => {
      calls.push(args);
      if (args[0] === 'list2') return Buffer.from('0,LD,1,2,1,3,4');
      if (args[0] === 'adb') return Buffer.from('emulator-5554');
      if (args[0] === 'devices')
        return Buffer.from('List of devices attached\nemulator-5554 device product:test');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return png;
    }, adb);
    await assert.rejects(capture.capture('0'), /choose/);
    assert.deepEqual(await capture.discover(), [
      { id: '0', name: 'LD', serial: 'emulator-5554', connected: true },
    ]);
    await assert.rejects(capture.capture('127.0.0.1:5555'), /choose/);
    const pending = capture.capture('0');
    await assert.rejects(capture.capture('0'), /busy/);
    await assert.rejects(capture.discover(), /busy/);
    release();
    const frame = await pending;
    assert.equal(frame.width, 640);
    assert.equal(frame.height, 360);
    assert.deepEqual(calls.at(-1), ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']);
    assert.equal(calls.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ADB failures, invalid PNGs and cancellation release the slot for a fresh capture', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hok-adb-recovery-'));
  try {
    const adb = join(dir, 'adb.exe');
    writeFileSync(adb, '');
    writeFileSync(join(dir, 'ldconsole.exe'), '');
    const png = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    let mode = 'error';
    const capture = new AdbCapture(async (_file, args, signal) => {
      if (args[0] === 'list2') return Buffer.from('0,LD,1,2,1,3,4');
      if (args[0] === 'adb') return Buffer.from('emulator-5554');
      if (args[0] === 'devices') return Buffer.from('emulator-5554 device');
      if (signal?.aborted) throw Error('Capture cancelled');
      if (mode === 'error') throw Error('Disconnected');
      return mode === 'invalid' ? Buffer.from('not a PNG') : png;
    }, adb);
    await capture.discover();
    await assert.rejects(capture.capture('0'), /Disconnected/);
    mode = 'invalid';
    await assert.rejects(capture.capture('0'), /PNG/);
    mode = 'ok';
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(capture.capture('0', controller.signal), /cancelled/);
    assert.equal((await capture.capture('0')).width, 640);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
