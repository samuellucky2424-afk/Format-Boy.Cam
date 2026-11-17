import type { LiveModelId } from './live-models';
import type { MorphlySession } from './morphly-session';

export async function applyMorphlyInput(
  session: MorphlySession,
  model: LiveModelId,
  prompt: string,
  image: File | null,
) {
  if (model === 'm2') {
    if (!image) throw Object.assign(new Error('M2.5 needs a reference image.'), { code: 'REFERENCE_IMAGE_REQUIRED' });
    await session.set({ image, editingType: 'subject_replacement' });
  } else if (image) {
    await session.set({ prompt, enhance: true, image });
  } else {
    await session.setPrompt(prompt, { enhance: true });
  }
}
