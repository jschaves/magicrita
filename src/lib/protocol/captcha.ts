const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let expected = "";

function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function issueCaptcha(): string {
  expected = randomCode(5);
  return expected;
}

export function verifyCaptcha(input: string): boolean {
  if (!expected) return false;
  const ok = input.trim().toUpperCase() === expected;
  if (ok) expected = "";
  return ok;
}

export function drawCaptcha(canvas: HTMLCanvasElement, code: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.fillStyle = "#fff8f1";
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 48; i++) {
    ctx.fillStyle = `rgba(91, 42, 110, ${0.06 + Math.random() * 0.18})`;
    ctx.beginPath();
    ctx.arc(Math.random() * width, Math.random() * height, 1 + Math.random() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(198, 30, 106, ${0.18 + Math.random() * 0.28})`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(Math.random() * width, Math.random() * height);
    ctx.lineTo(Math.random() * width, Math.random() * height);
    ctx.stroke();
  }

  const step = width / (code.length + 0.6);
  for (let i = 0; i < code.length; i++) {
    ctx.save();
    ctx.translate(step * (i + 0.55), height / 2 + (Math.random() * 12 - 6));
    ctx.rotate((Math.random() - 0.5) * 0.55);
    ctx.font = `700 ${26 + Math.random() * 8}px Nunito, ui-sans-serif, sans-serif`;
    ctx.fillStyle = i % 2 === 0 ? "#5b2a6e" : "#9b1854";
    ctx.fillText(code[i], 0, 8);
    ctx.restore();
  }
}
