import { describe, expect, it } from 'vitest';
import { assertCameraUrlAllowed, ipAllowed, parseCidrs, withCredentials } from './network';

const lan = parseCidrs('10.0.0.0/8, 192.168.0.0/16, 127.0.0.1/32');

describe('ipAllowed', () => {
  it('matches addresses inside approved ranges', () => {
    expect(ipAllowed('192.168.1.50', lan)).toBe(true);
    expect(ipAllowed('10.20.30.40', lan)).toBe(true);
  });

  it('rejects public and cloud metadata addresses', () => {
    expect(ipAllowed('8.8.8.8', lan)).toBe(false);
    expect(ipAllowed('169.254.169.254', lan)).toBe(false);
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(ipAllowed('::ffff:192.168.1.5', lan)).toBe(true);
    expect(ipAllowed('::ffff:8.8.8.8', lan)).toBe(false);
  });
});

describe('assertCameraUrlAllowed', () => {
  it('accepts an RTSP URL on an approved network', async () => {
    await expect(assertCameraUrlAllowed('rtsp://192.168.1.50:554/stream1', 'RTSP', lan)).resolves.toBeInstanceOf(URL);
  });

  it('rejects schemes not valid for the camera type', async () => {
    await expect(assertCameraUrlAllowed('file:///etc/passwd', 'RTSP', lan)).rejects.toThrow();
    await expect(assertCameraUrlAllowed('rtsp://192.168.1.5/s', 'HTTP_MJPEG', lan)).rejects.toThrow();
  });

  it('rejects embedded credentials', async () => {
    await expect(assertCameraUrlAllowed('rtsp://admin:pw@192.168.1.5/s', 'RTSP', lan)).rejects.toThrow();
  });

  it('rejects hosts outside approved networks', async () => {
    await expect(assertCameraUrlAllowed('http://169.254.169.254/latest', 'HTTP_MJPEG', lan)).rejects.toThrow();
  });

  it('blocked networks override approved ones (internal service subnets)', async () => {
    const blocked = parseCidrs('10.250.0.0/24, 127.0.0.0/8');
    await expect(assertCameraUrlAllowed('rtsp://10.250.0.5:6379/', 'RTSP', lan, blocked)).rejects.toThrow();
    await expect(assertCameraUrlAllowed('http://127.0.0.1:8000/health', 'HTTP_MJPEG', lan, blocked)).rejects.toThrow();
    await expect(assertCameraUrlAllowed('rtsp://10.20.0.5/s', 'RTSP', lan, blocked)).resolves.toBeInstanceOf(URL);
  });
});

describe('withCredentials', () => {
  it('injects URL-encoded credentials', () => {
    expect(withCredentials('rtsp://192.168.1.5/s', { username: 'ad@min', password: 'p:w/d' })).toBe(
      'rtsp://ad%40min:p%3Aw%2Fd@192.168.1.5/s',
    );
  });

  it('leaves the URL unchanged without credentials', () => {
    expect(withCredentials('rtsp://192.168.1.5/s', null)).toBe('rtsp://192.168.1.5/s');
  });
});
