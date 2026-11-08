import { execFile } from 'node:child_process';
import { dirname, join, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

export interface AdbDevice {
  id: string;
  name: string;
  serial: string;
  connected: boolean;
}
type Run = (file: string, args: string[], signal?: AbortSignal) => Promise<Buffer>;
export const runAdbCommand: Run = (file, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'buffer', timeout: 8000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, signal },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              signal?.aborted ? 'Capture cancelled' : 'ADB unavailable or capture timed out',
            ),
          );
        else resolve(stdout);
      },
    );
  });
export function parseLdInstances(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .flatMap((line) => {
      const fields = line.split(',');
      if (
        !/^\d+$/.test(fields[0]) ||
        fields.length < 7 ||
        fields[4] !== '1' ||
        Number(fields[5]) <= 0
      )
        return [];
      return [{ index: Number(fields[0]), name: fields[1] }];
    });
}
export const localAdbSerial = (serial: string) =>
  /^(emulator-\d{4,5}|127\.0\.0\.1:\d{4,5})$/.test(serial);

/** Only discovers running LDPlayer instances and captures their Android display.
 * No arbitrary executable, host, serial or shell command comes from an HTTP request. */
export class AdbCapture {
  private devices = new Map<string, AdbDevice>();
  private executable = '';
  private busy = false;
  constructor(
    private run: Run = runAdbCommand,
    private configuredPath = process.env.HOK_ADB_PATH,
  ) {}
  private async locate(signal?: AbortSignal) {
    if (this.configuredPath) {
      if (!isAbsolute(this.configuredPath) || !existsSync(this.configuredPath))
        throw Error('HOK_ADB_PATH must name an installed local adb executable');
      return this.configuredPath;
    }
    if (process.platform !== 'win32')
      throw Error('Configure the LDPlayer ADB installation on the local Windows host');
    const paths = JSON.parse(
      (
        await this.run(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '@(Get-CimInstance Win32_Process -Filter "Name = \'dnplayer.exe\'" | Select-Object -ExpandProperty ExecutablePath -Unique) | ConvertTo-Json -Compress',
          ],
          signal,
        )
      )
        .toString()
        .trim() || '[]',
    );
    const locations = (Array.isArray(paths) ? paths : [paths])
      .filter((p: unknown): p is string => typeof p === 'string')
      .map((p: string) => join(dirname(p), 'adb.exe'))
      .filter(existsSync);
    if (locations.length !== 1)
      throw Error(
        'Start LDPlayer, or set HOK_ADB_PATH locally when multiple installations are running',
      );
    return locations[0];
  }
  async discover(signal?: AbortSignal) {
    if (this.busy) throw Error('ADB capture is busy; retry after the current frame');
    this.busy = true;
    try {
      const adb = await this.locate(signal),
        consolePath = join(dirname(adb), 'ldconsole.exe');
      if (!existsSync(consolePath))
        throw Error('LDPlayer instance discovery requires its local ldconsole.exe');
      const instances = parseLdInstances(
        new TextDecoder('gb18030').decode(await this.run(consolePath, ['list2'], signal)),
      );
      const found: AdbDevice[] = [];
      for (const instance of instances.slice(0, 16)) {
        const serial = (
          await this.run(
            consolePath,
            ['adb', '--index', String(instance.index), '--command', 'get-serialno'],
            signal,
          )
        )
          .toString()
          .trim();
        if (!localAdbSerial(serial)) continue;
        found.push({
          id: String(instance.index),
          name: instance.name || `LDPlayer ${instance.index}`,
          serial,
          connected: false,
        });
      }
      const attached = (await this.run(adb, ['devices', '-l'], signal)).toString();
      for (const device of found)
        device.connected = attached
          .split(/\r?\n/)
          .some(
            (line) => line.split(/\s+/)[0] === device.serial && line.split(/\s+/)[1] === 'device',
          );
      this.executable = adb;
      this.devices = new Map(found.map((device) => [device.id, device]));
      return found;
    } finally {
      this.busy = false;
    }
  }
  async capture(id: string, signal?: AbortSignal) {
    const device = this.devices.get(id);
    if (!device || !this.executable)
      throw Error('Refresh devices and choose a verified LDPlayer instance');
    if (this.busy) throw Error('ADB capture is busy; no frames are queued');
    this.busy = true;
    const start = performance.now();
    try {
      // shortcut: PNG screencap is below 1Hz on tested LDPlayer; use a measured stream adapter if 1Hz is required.
      const image = await this.run(
        this.executable,
        ['-s', device.serial, 'exec-out', 'screencap', '-p'],
        signal,
      );
      const captureMs = performance.now() - start,
        decodeStart = performance.now();
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw Error('ADB did not return a PNG frame');
      const metadata = await sharp(image, { limitInputPixels: 9000000 }).metadata();
      if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 2160)
        throw Error('ADB frame dimensions unsupported');
      await sharp(image, { limitInputPixels: 9000000 }).raw().toBuffer();
      if (signal?.aborted) throw Error('Capture cancelled');
      return {
        image,
        width: metadata.width,
        height: metadata.height,
        captureMs,
        decodeMs: performance.now() - decodeStart,
        capturedAt: Date.now(),
      };
    } finally {
      this.busy = false;
    }
  }
}
