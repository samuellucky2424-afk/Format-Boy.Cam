import type { SessionCommands, SessionStatus } from './sessionContext';
import { toMod4 } from '@/lib/imagePrep';
import { promptForProvider } from '@/lib/personaPrompts';
import type { Persona } from '@/lib/personas';

async function blobFromImageUrl(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load persona image.');
  return response.blob();
}

export async function preparePersonaImage(persona: Persona, minimumSide = 4): Promise<Blob> {
  if (!persona.imageUrl) throw new Error('This persona has no image yet.');
  const blob = await blobFromImageUrl(persona.imageUrl);
  return toMod4(new File([blob], `${persona.name}.jpg`, { type: blob.type || 'image/jpeg' }), minimumSide);
}

export async function waitForSessionReady(
  getStatus: () => SessionStatus,
  connect: () => Promise<void>,
  timeoutMs = 90_000,
): Promise<void> {
  if (getStatus() === 'ready') return;
  if (getStatus() === 'disconnected') await connect();

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = getStatus();
    if (status === 'ready') return;
    if (status === 'disconnected') throw new Error('Session disconnected before it was ready.');
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the session to become ready.');
}

async function waitForDisconnected(getStatus: () => SessionStatus, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (getStatus() === 'disconnected') return;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the session to disconnect.');
}

/** Upload the prepared reference, wait for X2's acceptance, then arm generation. */
export async function applyPersonaToSession(
  session: SessionCommands,
  persona: Persona,
  getStatus?: () => SessionStatus,
  preparedImage?: Blob,
): Promise<void> {
  const ready = () => (getStatus ? getStatus() : session.status) === 'ready';
  if (!ready()) throw new Error('Start a session before applying a persona.');
  if (!persona.imageUrl) throw new Error('This persona has no image yet.');

  const prepared = preparedImage ?? (await preparePersonaImage(persona, session.kind === 'pro' ? 512 : 4));
  const prompt = promptForProvider(persona.prompt, session.kind, persona.name);

  if (session.kind === 'pro') {
    await session.setReferenceImage({ blob: prepared });
    await session.setPrompt({ prompt });
    return;
  }

  if (!session.uploadFile) throw new Error('Reactor file upload is unavailable.');
  const reference = await session.uploadFile(prepared, { name: `${persona.name}.jpg` });
  await session.setReferenceImage({ reference_image: reference });

  const acceptedAt = Date.now();
  while (!session.hasReference?.() && Date.now() - acceptedAt < 8_000) {
    if (!ready()) throw new Error('Reactor disconnected while accepting the persona image.');
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  if (!session.hasReference?.()) {
    throw new Error('Reactor did not accept the persona image before the timeout.');
  }

  await session.setKeepBacklog({ keep_backlog: false });
  await session.setPrompt({ prompt });
  await session.setPointer({ x: 0.5, y: 0.5, active: false });
}

export async function stopLiveSession(
  session: SessionCommands,
  getStatus?: () => SessionStatus,
): Promise<void> {
  const status = getStatus ? getStatus() : session.status;
  if (status === 'disconnected') return;
  await session.disconnect();
  if (getStatus) await waitForDisconnected(getStatus);
}

export async function startLiveSession(
  session: SessionCommands,
  getStatus: (() => SessionStatus) | undefined,
  persona: Persona,
  sourceStream: MediaStream | null,
  billingSessionId?: string,
): Promise<void> {
  if (!sourceStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
    throw new Error('A live camera stream is required.');
  }
  if (!persona.imageUrl) throw new Error('Choose a persona before starting.');

  const status = getStatus ?? (() => session.status);
  const prompt = promptForProvider(persona.prompt, session.kind, persona.name);
  const prepared = await preparePersonaImage(persona, session.kind === 'pro' ? 512 : 4);

  if (session.kind === 'pro') {
    await waitForSessionReady(
      status,
      () => session.connect({ stream: sourceStream, prompt, image: prepared, billingSessionId }),
      70_000,
    );
    return;
  }

  await waitForSessionReady(status, () => session.connect());
  await applyPersonaToSession(session, persona, status, prepared);
}

export async function restartLiveSession(
  session: SessionCommands,
  getStatus: (() => SessionStatus) | undefined,
  persona: Persona,
  sourceStream: MediaStream | null,
): Promise<void> {
  if (session.kind === 'pro' && (getStatus ? getStatus() : session.status) === 'ready') {
    await applyPersonaToSession(session, persona, getStatus);
    return;
  }
  await stopLiveSession(session, getStatus);
  await startLiveSession(session, getStatus, persona, sourceStream);
}
