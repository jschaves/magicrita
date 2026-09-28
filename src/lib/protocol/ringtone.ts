/**
 * Tono de llamada entrante, generado con Web Audio (sin ficheros ni terceros).
 * Suena en bucle con la cadencia clasica hasta que se descuelga, se rechaza o
 * la llamada caduca. Solo lo usa el que recibe: el que llama no oye nada.
 */
const RING_MS = 3000;
const RING_DURATION = 1.05;

let ctx: AudioContext | null = null;
let timer: number | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

function ringBurst(context: AudioContext): void {
  const now = context.currentTime;
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
  gain.gain.setValueAtTime(0.12, now + RING_DURATION - 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + RING_DURATION);
  // Dos tonos a la vez: el timbre "de telefono" clasico.
  for (const frequency of [440, 480]) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + RING_DURATION);
  }
}

export function startRinging(): void {
  if (timer !== null) return;
  const context = audioContext();
  if (!context) return;
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  const play = () => {
    const active = audioContext();
    if (active) ringBurst(active);
  };
  play();
  timer = window.setInterval(play, RING_MS);
}

export function stopRinging(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}
