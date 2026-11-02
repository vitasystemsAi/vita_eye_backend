export type VideoKind = 'builtin' | 'usb' | 'virtual' | 'unknown';

/** The browser cannot see the physical USB port. Names are the only signal it gives. */
export function classifyVideoInput(label: string): VideoKind {
  const name = label.trim().toLowerCase();
  if (!name) return 'unknown';
  if (/virtual|obs virtual|manycam|snap camera|mmhmm|droidcam/.test(name)) return 'virtual';
  if (/integrated|built[-\s]?in|facetime|internal|laptop|truevision|infrared|\bir camera\b|easy camera|front camera|user-facing|hp hd camera/.test(name)) return 'builtin';
  if (/usb|uvc|usb-?c|type-?c|external|logitech|brio|\bc9\d{2}\b|\bc270\b|\bc310\b|capture card|elgato|hdmi capture/.test(name)) return 'usb';
  return 'unknown';
}

export function splitVideoInputs(devices: MediaDeviceInfo[]): { cable: MediaDeviceInfo[]; laptops: MediaDeviceInfo[] } {
  const labeled = devices.filter((device) => device.deviceId);
  const laptops = labeled.filter((device) => {
    const kind = classifyVideoInput(device.label);
    return kind === 'builtin' || kind === 'virtual';
  });
  const usb = labeled.filter((device) => classifyVideoInput(device.label) === 'usb');
  const unknown = labeled.filter((device) => classifyVideoInput(device.label) === 'unknown');
  if (usb.length) return { cable: usb, laptops };
  if (laptops.length && unknown.length) return { cable: unknown, laptops };
  if (labeled.length <= 1) return { cable: [], laptops: labeled.length ? labeled : laptops };
  return { cable: labeled, laptops: [] };
}

/** Asks for camera permission once so device names are available, then lists video inputs. */
export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const read = async () => (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  let devices = await read();
  if (devices.length && devices.every((device) => !device.label) && navigator.mediaDevices.getUserMedia) {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    probe.getTracks().forEach((track) => track.stop());
    devices = await read();
  }
  return devices;
}

/** Opens a cable camera. Never substitutes the laptop webcam. */
export async function resolveUsbDeviceId(preferred: string): Promise<string> {
  const devices = await listVideoInputs();
  const { cable } = splitVideoInputs(devices);
  if (preferred) {
    const match = devices.find((device) => device.deviceId === preferred);
    if (!match) throw new Error('That USB camera is not connected. Plug it in, then detect and select it again.');
    if (classifyVideoInput(match.label) === 'builtin') throw new Error('That device is the laptop camera. Select a USB or USB-C camera.');
    if (classifyVideoInput(match.label) === 'virtual') throw new Error('That device is a virtual camera. Select a USB or USB-C camera.');
    return preferred;
  }
  if (!cable.length) throw new Error('No USB or USB-C camera is connected. Plug the cable into this computer and detect again. The laptop camera is not used.');
  return cable[0]?.deviceId ?? '';
}
