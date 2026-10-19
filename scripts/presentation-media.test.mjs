import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClipProbe } from './presentation-media.mjs';

const valid = () => ({
  streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 390, height: 844 }],
  format: { duration: '25.000' },
});

test('accepts an embeddable 25 second clip', () => {
  assert.deepEqual(validateClipProbe(valid()), { seconds: 25, width: 390, height: 844 });
});
test('rejects missing, short, long and non-finite recordings', () => {
  for (const duration of [undefined, '0', '19.9', '30.1', 'NaN', 'Infinity']) {
    const probe = valid();
    probe.format.duration = duration;
    assert.throws(() => validateClipProbe(probe), /25 seconds/);
  }
});
test('rejects empty recordings and incompatible video formats', () => {
  assert.throws(() => validateClipProbe({ streams: [] }), /H.264/);
  for (const field of ['codec_name', 'pix_fmt']) {
    const probe = valid();
    probe.streams[0][field] = 'unsupported';
    assert.throws(() => validateClipProbe(probe), /H.264/);
  }
  const probe = valid();
  probe.streams[0].width = 320;
  assert.throws(() => validateClipProbe(probe), /dimensions/);
});
