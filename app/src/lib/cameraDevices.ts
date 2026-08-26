export interface CameraDeviceOption {
  deviceId: string;
  label: string;
  index: number;
}

// Hide our own virtual outputs from the picker — only physical cameras.
const VIRTUAL_CAMERA_PATTERN = /henshin|ghostswap|formatboy|virtual/i;

export function isVirtualCameraLabel(label: string): boolean {
  return VIRTUAL_CAMERA_PATTERN.test(label);
}

export async function listPhysicalCameras(): Promise<CameraDeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  let devices = await navigator.mediaDevices.enumerateDevices();
  const needsPermission = devices.every((d) => d.kind !== 'videoinput' || !d.label);

  if (needsPermission) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  }

  return devices
    .filter((d) => d.kind === 'videoinput')
    .filter((d) => !isVirtualCameraLabel(d.label || ''))
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label?.trim() || `Camera ${index + 1}`,
      index,
    }));
}

export async function openCameraPreview(deviceId: string): Promise<MediaStream> {
  // Picker preview only — keep constraints light so DirectShow switches faster.
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15, max: 24 },
    },
    audio: false,
  });
}
