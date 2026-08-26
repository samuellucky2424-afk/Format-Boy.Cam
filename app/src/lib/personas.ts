// Client-side persona store. A persona = portrait + prompt.
// User personas live in localStorage (no bundled manifest in Henshin).
import { defaultPersonaPrompt } from './personaPrompts';

const KEY = 'henshin.personas.v1';
const ACTIVE_KEY = 'henshin.activePersona.v1';

export interface Persona {
  id: string;
  name: string;
  /** URL of the persona portrait (data URL or blob URL). */
  imageUrl: string | null;
  prompt: string;
  createdAt: number;
}

export function listPersonas(): Persona[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Persona[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePersonas(personas: Persona[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(personas));
  } catch {
    /* storage full/blocked — personas are best-effort local */
  }
}

export function upsertPersona(p: Persona): Persona[] {
  const all = listPersonas();
  const i = all.findIndex((x) => x.id === p.id);
  if (i >= 0) all[i] = p;
  else all.push(p);
  savePersonas(all);
  return all;
}

export function deletePersona(id: string): Persona[] {
  const all = listPersonas().filter((p) => p.id !== id);
  savePersonas(all);
  return all;
}

export function newPersonaId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function loadActivePersonaId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActivePersonaId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* best effort */
  }
}

export async function loadAllPersonas(): Promise<Persona[]> {
  return listPersonas().sort((a, b) => a.name.localeCompare(b.name));
}

export function createPersonaFromFile(name: string, imageDataUrl: string): Persona {
  return {
    id: newPersonaId(),
    name: name.trim(),
    imageUrl: imageDataUrl,
    prompt: defaultPersonaPrompt(name.trim()),
    createdAt: Date.now(),
  };
}
