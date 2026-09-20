/** Shared getUserMedia helpers for spirit-box mic and EVP capture. */

export function inEmbeddedPreview() {
  try {
    if (/\.grok\.me$/i.test(window.location.hostname)) return false;
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function micErrorMessage(err: unknown) {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "NotFoundError") return "No microphone found on this device.";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Chrome is blocking the mic. Phone Settings → Chrome → Microphone → On. Then come back, Arm, and tap Mic.";
  }
  if (inEmbeddedPreview()) {
    return "Open the published grok.me link in Chrome or Safari, not inside Grok chat. Then Arm and tap Mic.";
  }
  return "The mic didn't open. Close other apps using it, Arm, then tap Mic again and choose Allow.";
}

export async function requestMic(): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error("unsupported");
  try {
    return await devices.getUserMedia({ audio: true, video: false });
  } catch (first) {
    try {
      return await devices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch {
      throw first;
    }
  }
}

/** Prefer formats MediaRecorder typically supports on mobile Chrome/Safari. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}
