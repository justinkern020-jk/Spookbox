/** Shared getUserMedia helpers for SLS / environment camera capture. */

import { inEmbeddedPreview } from "@/lib/box/mic";

export function cameraErrorMessage(err: unknown) {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "NotFoundError") return "No camera found on this device.";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Chrome is blocking the camera. Phone Settings → Chrome → Camera → On. Then come back and Arm camera.";
  }
  if (name === "NotReadableError") {
    return "Camera is busy in another app. Close it, then Arm camera again.";
  }
  if (name === "OverconstrainedError") {
    return "This device can't open the rear camera. Arm again — front camera will be used if available.";
  }
  if (inEmbeddedPreview()) {
    return "Open the published grok.me link in Chrome or Safari, not inside Grok chat. Then Arm camera.";
  }
  return "The camera didn't open. Close other apps using it, then Arm camera and choose Allow.";
}

type VideoFacing = "environment" | "user";

async function openFacing(facingMode: VideoFacing): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error("unsupported");
  return devices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}

/**
 * Prefer rear / environment camera for field work; fall back to user-facing.
 * Returns the stream and which facing ultimately opened.
 */
export async function requestCamera(): Promise<{
  stream: MediaStream;
  facing: VideoFacing;
}> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error("unsupported");

  try {
    const stream = await openFacing("environment");
    return { stream, facing: "environment" };
  } catch (first) {
    const name =
      first && typeof first === "object" && "name" in first ? String(first.name) : "";
    // Permission / missing device — don't silently flip to selfie cam after deny.
    if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") {
      throw first;
    }
    try {
      const stream = await openFacing("user");
      return { stream, facing: "user" };
    } catch {
      throw first;
    }
  }
}
