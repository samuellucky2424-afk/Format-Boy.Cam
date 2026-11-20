import type { LiveModelId } from './live-models';
import type { MorphlySession } from './morphly-session';

// Docs: session.set({ prompt: "Use this character's appearance", image }).
// An empty prompt makes the engine keep the camera scene.
export const DEFAULT_REFERENCE_PROMPT = "Use this character's appearance";

export function promptForReference(prompt: string) {
  return prompt.trim() || DEFAULT_REFERENCE_PROMPT;
}

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
    await session.set({ prompt: promptForReference(prompt), image });
  } else {
    await session.setPrompt(prompt, { enhance: true });
  }
}
