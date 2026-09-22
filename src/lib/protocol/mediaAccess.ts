export function isSecureMedia(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export function dropStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore
    }
  });
}

export async function getMicStream(): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error("noddevices");
  try {
    return await devices.getUserMedia({ audio: true });
  } catch {
    return await devices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  }
}

export async function getCameraStream(): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error("noddevices");
  try {
    return await devices.getUserMedia({ audio: true, video: true });
  } catch {
    return await devices.getUserMedia({ video: true });
  }
}
