import fixWebmDuration from "fix-webm-duration";

function encodeWav(buffer: AudioBuffer): Blob {
  const rate = buffer.sampleRate;
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const pcm = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) pcm[i] += (data[i] ?? 0) / channels;
  }
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  let p = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    p += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export async function recorderAudioToWav(blob: Blob): Promise<Blob> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return blob;
  const ctx = new AC();
  try {
    const copy = (await blob.arrayBuffer()).slice(0);
    const audio = await ctx.decodeAudioData(copy);
    if (audio.duration < 0.05) return blob;
    return encodeWav(audio);
  } catch {
    return blob;
  } finally {
    void ctx.close();
  }
}

export async function stampMediaDuration(blob: Blob, durationMs: number): Promise<Blob> {
  const ms = Math.max(250, durationMs);
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isWebm = head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  if (!isWebm) return blob;
  try {
    const fix = fixWebmDuration as unknown as (
      blob: Blob,
      duration: number,
      options?: { logger?: false },
    ) => Promise<Blob>;
    const out = await fix(blob, ms, { logger: false });
    const data = new Uint8Array(await out.arrayBuffer());
    return new Blob([data], { type: blob.type || "video/webm" });
  } catch {
    return blob;
  }
}

function appleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iP(hone|ad|od)/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|Android/i.test(ua);
}

export function revealMediaDuration(el: HTMLMediaElement | null): void {
  if (!el || el.dataset.ritaDur === "1") return;
  if (appleWebKit()) {
    el.dataset.ritaDur = "1";
    return;
  }
  const go = () => {
    if (el.dataset.ritaDur === "1") return;
    const duration = el.duration;
    if (Number.isFinite(duration) && duration > 0.25) {
      el.dataset.ritaDur = "1";
      return;
    }
    const onSeeked = () => {
      el.removeEventListener("seeked", onSeeked);
      el.currentTime = 0.001;
      el.dataset.ritaDur = "1";
    };
    el.addEventListener("seeked", onSeeked);
    try {
      el.currentTime = 1e16;
    } catch {
      el.removeEventListener("seeked", onSeeked);
    }
  };
  if (el.readyState >= 1) go();
  else el.addEventListener("loadedmetadata", go, { once: true });
}
