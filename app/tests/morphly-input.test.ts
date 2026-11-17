import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMorphlyInput } from '../src/lib/morphly-input';
import type { MorphlySession } from '../src/lib/morphly-session';

function fixture() {
  const updates: unknown[] = [];
  const prompts: unknown[] = [];
  const session: MorphlySession = {
    set: async (value) => { updates.push(value); },
    setPrompt: async (...args) => { prompts.push(args); },
    disconnect: async () => {}, on() {}, off() {},
  };
  return { session, updates, prompts };
}

test('M2.1 sends the exact prompt together with the original reference file', async () => {
  const f = fixture();
  const image = new File(['reference fixture'], 'character.png', { type: 'image/png' });
  const prompt = 'Become the character in the reference image';
  await applyMorphlyInput(f.session, 'm1', prompt, image);
  assert.deepEqual(f.updates, [{ prompt, enhance: true, image }]);
  assert.strictEqual((f.updates[0] as { image: File }).image, image);
  assert.deepEqual(f.prompts, []);
});

test('changing the reference sends the new file with subsequent prompts', async () => {
  const f = fixture();
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });
  await applyMorphlyInput(f.session, 'm1', 'first prompt', first);
  await applyMorphlyInput(f.session, 'm1', 'second prompt', second);
  assert.deepEqual(f.updates[1], { prompt: 'second prompt', enhance: true, image: second });
  assert.strictEqual((f.updates[1] as { image: File }).image, second);
});

test('M2.1 without an image preserves text-only prompts', async () => {
  const f = fixture();
  await applyMorphlyInput(f.session, 'm1', 'Watercolor', null);
  assert.deepEqual(f.updates, []);
  assert.deepEqual(f.prompts, [['Watercolor', { enhance: true }]]);
});

test('M2.5 sends image and editing mode without text', async () => {
  const f = fixture();
  const image = new File(['reference'], 'character.webp', { type: 'image/webp' });
  await applyMorphlyInput(f.session, 'm2', 'unused prompt', image);
  assert.deepEqual(f.updates, [{ image, editingType: 'subject_replacement' }]);
  assert.deepEqual(f.prompts, []);
  await assert.rejects(applyMorphlyInput(f.session, 'm2', '', null), { code: 'REFERENCE_IMAGE_REQUIRED' });
});

test('reference update failures propagate instead of reporting success', async () => {
  const f = fixture();
  const failure = new Error('Image rejected');
  f.session.set = async () => { throw failure; };
  const image = new File(['reference'], 'character.png', { type: 'image/png' });
  await assert.rejects(applyMorphlyInput(f.session, 'm1', 'prompt', image), failure);
});
