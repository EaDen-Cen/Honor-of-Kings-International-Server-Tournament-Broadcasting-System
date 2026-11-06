import { useEffect, useRef, useState } from 'react';
import { CaptureRegionPicker } from './CaptureRegionPicker';
import { fullGameRect, pixelRect, type CaptureRect } from '../shared/gameCapture';

interface Device {
  id: string;
  name: string;
  connected: boolean;
}
/** GHUD owns this source; switching it never changes the shared BP/settlement stream. */
export function useAdbHudCapture(zh: boolean, token: string, active: boolean) {
  const [devices, setDevices] = useState<Device[]>([]),
    [device, setDevice] = useState('');
  const [dimensions, setDimensions] = useState(''),
    [crop, setCrop] = useState<CaptureRect>(fullGameRect);
  const [preview, setPreview] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [sourceVersion, setSourceVersion] = useState(0);
  const generation = useRef(0),
    pending = useRef<AbortController>(),
    mounted = useRef(false);
  const size = useRef('');
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  function invalidate() {
    generation.current++;
    setSourceVersion(generation.current);
  }
  useEffect(() => {
    const sourceGeneration = generation;
    mounted.current = true;
    setBusy(false);
    generation.current++;
    setSourceVersion(generation.current);
    return () => {
      mounted.current = false;
      sourceGeneration.current++;
      pending.current?.abort();
      pending.current = undefined;
    };
  }, [active, token]);
  async function request(path: string, signal?: AbortSignal) {
    if (pending.current)
      throw Error(zh ? '上一帧尚未结束，请稍候。' : 'Previous ADB request is still running');
    const controller = new AbortController(),
      version = generation.current;
    const abort = () => controller.abort();
    pending.current = controller;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 15000);
    setBusy(true);
    try {
      const response = await fetch(`${base}/api/v1/capture/adb/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) throw Error((await response.json()).error || 'ADB request failed');
      const data = path === 'devices' ? await response.json() : await response.blob();
      if (controller.signal.aborted || !mounted.current || version !== generation.current)
        throw Error('Capture source changed');
      setError('');
      return data;
    } catch (e) {
      if (mounted.current && version === generation.current)
        setError(e instanceof Error ? e.message : 'ADB unavailable');
      throw e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (pending.current === controller) {
        pending.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function refresh() {
    try {
      const data = await request('devices');
      if (
        !Array.isArray(data?.devices) ||
        data.devices.length > 16 ||
        data.devices.some(
          (d: Device) =>
            !d ||
            typeof d.id !== 'string' ||
            !/^\d{1,4}$/.test(d.id) ||
            typeof d.name !== 'string' ||
            typeof d.connected !== 'boolean',
        )
      )
        throw Error('Invalid LDPlayer device response');
      setDevices(data.devices);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'ADB unavailable');
    }
  }
  async function rawFrame(signal?: AbortSignal) {
    if (!active || !device) throw Error(zh ? '请选择雷电实例。' : 'Choose an LDPlayer instance');
    const version = generation.current;
    const blob: Blob = await request(`frame?device=${encodeURIComponent(device)}`, signal);
    if (blob.size > 16 * 1024 * 1024 || blob.type !== 'image/png')
      throw Error('Invalid ADB frame response');
    const bitmap = await createImageBitmap(blob);
    try {
      if (version !== generation.current || signal?.aborted) throw Error('Capture source changed');
      if (bitmap.width > 4096 || bitmap.height > 2160 || bitmap.width * bitmap.height > 9000000)
        throw Error('ADB frame dimensions unsupported');
      const next = `${bitmap.width}x${bitmap.height}`;
      const changed = !!size.current && size.current !== next;
      if (size.current !== next) {
        size.current = next;
        setDimensions(next);
        invalidate();
      }
      if (changed) {
        setPreview('');
        setCrop(fullGameRect);
        throw Error(zh ? '分辨率已改变，请重新校准。' : 'Resolution changed; recalibrate');
      }
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  }
  async function frame(signal?: AbortSignal) {
    const raw = await rawFrame(signal),
      bounds = pixelRect(crop, raw.width, raw.height);
    if (Math.abs(bounds.width / bounds.height - 16 / 9) > 0.025)
      throw Error(zh ? '请框选 16:9 游戏内容。' : 'Select the 16:9 game content');
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    canvas
      .getContext('2d')!
      .drawImage(raw, bounds.left, bounds.top, bounds.width, bounds.height, 0, 0, 1920, 1080);
    return canvas;
  }
  return {
    frame,
    ready: !!device && !!dimensions,
    generation,
    sourceVersion,
    isStill: false,
    calibrationKey: JSON.stringify(['adb', device, dimensions, crop]),
    controls: (
      <section aria-label="Android ADB capture">
        <p className="muted">
          {zh
            ? '仅采集本机雷电游戏画面。首次连接或更换实例后，先预览并重新确认识别区域。'
            : 'Local LDPlayer game capture only. Preview and recalibrate after changing instances.'}
        </p>
        <div className="toolbar">
          <button disabled={busy} onClick={() => void refresh()}>
            {zh ? '刷新雷电实例' : 'Refresh LDPlayer instances'}
          </button>
          <label>
            {zh ? '雷电实例' : 'LDPlayer instance'}
            <select
              aria-label="LDPlayer instance"
              value={device}
              disabled={busy}
              onChange={(e) => {
                invalidate();
                setDevice(e.target.value);
                setDimensions('');
                size.current = '';
                setCrop(fullGameRect);
                setPreview('');
                setError('');
              }}
            >
              <option value="">{zh ? '请选择' : 'Choose instance'}</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.connected}>
                  {d.name}
                  {d.connected ? '' : zh ? '（未连接）' : ' (offline)'}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !device}
            onClick={() =>
              void rawFrame()
                .then((c) => setPreview(c.toDataURL('image/jpeg', 0.88)))
                .catch((e) => setError(e instanceof Error ? e.message : 'Capture failed'))
            }
          >
            {zh ? '连接 / 重连并预览' : 'Connect / reconnect and preview'}
          </button>
          <span>{dimensions}</span>
        </div>
        {preview && (
          <details>
            <summary>{zh ? '框选 ADB 游戏内容' : 'Select ADB game content'}</summary>
            <CaptureRegionPicker
              image={preview}
              regions={[{ id: 'content', label: zh ? '游戏内容' : 'Game content', region: crop }]}
              selected="content"
              zh={zh}
              label="ADB game content"
              aspectRatio={16 / 9}
              disabled={busy}
              onChange={(value) => {
                invalidate();
                setCrop(value);
              }}
            />
          </details>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    ),
  };
}
