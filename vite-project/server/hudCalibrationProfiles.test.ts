import assert from 'node:assert/strict';
import test from 'node:test';
import { loadHudCalibration, saveHudCalibration } from '../src/control/hudCalibrationProfiles.js';
import { liveCaptureRects } from '../src/shared/gameCapture.js';
import { operatorPreferenceKey } from '../src/shared/operatorPreferences.js';

test('HUD calibration separates source/dimensions/crop and never migrates Windows coordinates to ADB', () => {
  assert.equal(operatorPreferenceKey('hok-ghud-calibration-v2'), true);
  assert.equal(operatorPreferenceKey('hok-ghud-calibration-v1'), true);
  assert.equal(operatorPreferenceKey('hok-ghud-calibration-secrets'), false);
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const custom = structuredClone(liveCaptureRects);
  custom.blueGold.width = 0.06;
  storage.setItem('hok-ghud-calibration-v1', JSON.stringify(custom));
  assert.deepEqual(loadHudCalibration(storage, '["window",1920,1080]'), custom);
  assert.deepEqual(loadHudCalibration(storage, '["adb","0",1920,1080]'), liveCaptureRects);
  saveHudCalibration(storage, '["adb","0",1920,1080]', custom);
  assert.deepEqual(loadHudCalibration(storage, '["adb","0",1920,1080]'), custom);
  assert.deepEqual(loadHudCalibration(storage, '["adb","1",1920,1080]'), liveCaptureRects);
  for (let i = 0; i < 20; i++) saveHudCalibration(storage, `source-${i}`, liveCaptureRects);
  assert.equal(JSON.parse(storage.getItem('hok-ghud-calibration-v2')!).length, 12);
  storage.setItem('hok-ghud-calibration-v2', 'invalid');
  assert.deepEqual(loadHudCalibration(storage, '["adb"]'), liveCaptureRects);
});
