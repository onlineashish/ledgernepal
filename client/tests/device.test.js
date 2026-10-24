import { describe, expect, it } from 'vitest';
import { describeDevice, timeAgo } from '../src/lib/device.js';

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/150 Safari/537.36 Edg/150.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Version/17 Safari/605.1.15', 'Safari on macOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604', 'Safari on iOS'],
    ['curl/8.5.0', 'Browser'],
    ['', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  it.each([
    ['2026-10-25T12:00:00Z', 'just now'],
    ['2026-10-25T11:59:30Z', 'just now'],
    ['2026-10-25T11:59:00Z', '1 minute ago'],
    ['2026-10-25T11:15:00Z', '45 minutes ago'],
    ['2026-10-25T11:00:00Z', '1 hour ago'],
    ['2026-10-25T09:00:00Z', '3 hours ago'],
    ['2026-10-24T12:00:00Z', '1 day ago'],
    ['2026-10-20T12:00:00Z', '5 days ago'],
    ['2026-10-26T12:00:00Z', 'just now'], // a clock slightly ahead never shows a negative time
  ])('%s', (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});
