// PersonaPanel — left column of the Studio (adapted from fxswap37).
// A persona = portrait + prompt. Selecting one while live restarts the session.
import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, Plus } from 'lucide-react';
import { MetalIconButton } from '@/components/ui/metal-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import {
  createPersonaFromFile,
  deletePersona,
  loadActivePersonaId,
  loadAllPersonas,
  saveActivePersonaId,
  upsertPersona,
  type Persona,
} from '@/lib/personas';
import { defaultPersonaPrompt } from '@/lib/personaPrompts';
import { restartLiveSession } from '@/lib/session/applyPersona';
import { useSessionCommands } from '@/lib/session/sessionContext';
import { AddPersonaDialog } from './AddPersonaDialog';
import { ConfirmDialog } from './ConfirmDialog';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PersonaPanel({
  resetNonce,
  sourceStream,
  onActivePersonaChange,
  onCollapse,
}: {
  resetNonce: number;
  sourceStream?: MediaStream | null;
  onActivePersonaChange: (persona: Persona | null) => void;
  onCollapse: () => void;
}) {
  const session = useSessionCommands();
  const statusRef = useRef(session.status);

  const fileRef = useRef<HTMLInputElement>(null);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<
    | { kind: 'select'; persona: Persona }
    | { kind: 'replace'; file: File }
    | null
  >(null);

  const live = session.status !== 'disconnected';
  const activePersona = personas.find((p) => p.id === activeId) ?? null;

  const onChangeRef = useRef(onActivePersonaChange);

  useEffect(() => {
    statusRef.current = session.status;
  }, [session.status]);

  useEffect(() => {
    onChangeRef.current = onActivePersonaChange;
  }, [onActivePersonaChange]);

  useEffect(() => {
    let cancelled = false;
    void loadAllPersonas().then((all) => {
      if (cancelled) return;
      setPersonas(all);
      const stored = loadActivePersonaId();
      const fromStorage = stored ? all.find((p) => p.id === stored) : undefined;
      const initial = fromStorage ?? all[0] ?? null;
      setActiveId(initial?.id ?? null);
      onChangeRef.current(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [resetNonce]);

  useEffect(() => {
    onChangeRef.current(activePersona);
  }, [activePersona]);

  const selectLocally = (persona: Persona) => {
    setActiveId(persona.id);
    saveActivePersonaId(persona.id);
    setError(null);
  };

  const applyLive = async (persona: Persona) => {
    setBusy(true);
    setError(null);
    try {
      await restartLiveSession(session, () => statusRef.current, persona, sourceStream ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const selectPersona = (persona: Persona) => {
    if (persona.id === activeId) return;
    if (live) {
      setPending({ kind: 'select', persona });
      return;
    }
    selectLocally(persona);
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const replaceImage = async (file?: File) => {
    if (!file || !activePersona) return;
    setBusy(true);
    setError(null);
    try {
      const imageUrl = await readFileAsDataUrl(file);
      const updated: Persona = { ...activePersona, imageUrl };
      setPersonas(upsertPersona(updated));
      if (live) {
        await restartLiveSession(session, () => statusRef.current, updated, sourceStream ?? null);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveNewPersona = async (name: string, file: File) => {
    setBusy(true);
    setError(null);
    try {
      const imageUrl = await readFileAsDataUrl(file);
      const persona = createPersonaFromFile(name, imageUrl);
      upsertPersona(persona);
      const merged = await loadAllPersonas();
      setPersonas(merged.length ? merged : [persona]);
      setAdding(false);
      if (live) {
        setPending({ kind: 'select', persona });
        return;
      }
      selectLocally(persona);
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const removePersona = (persona: Persona) => {
    const all = deletePersona(persona.id);
    void loadAllPersonas().then(setPersonas);
    if (activeId === persona.id) {
      const next = all[0] ?? null;
      setActiveId(next?.id ?? null);
      saveActivePersonaId(next?.id ?? null);
    }
  };

  return (
    <section className="flex flex-col">
      <header className="flex items-start justify-between gap-2 px-1 py-3">
        <div className="min-w-0">
          <p className="kpi-label">Persona</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Portrait applied to the live camera. Press Start when ready.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <MetalIconButton
            variant="ghost"
            strength={0.4}
            disableGlow
            aria-label="Collapse persona panel"
            title="Collapse persona panel"
            onClick={onCollapse}
          >
            <PanelLeftClose className="size-4" />
          </MetalIconButton>
          <MetalIconButton
            variant="ghost"
            strength={0.48}
            disableGlow
            aria-label="Add persona"
            title="Add persona"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" />
          </MetalIconButton>
        </div>
      </header>

      <div>
        {activePersona?.imageUrl ? (
          <TextureCard className="mb-4 overflow-hidden">
            <img
              src={activePersona.imageUrl}
              alt={activePersona.name}
              className="aspect-[4/5] w-full object-cover"
            />
            <div className="px-3 py-2.5">
              <p className="text-sm font-medium leading-tight text-foreground">{activePersona.name}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {activePersona.prompt || defaultPersonaPrompt()}
              </p>
              <label className="mt-2 inline-block cursor-pointer text-[11px] text-blue-400 underline-offset-2 hover:underline">
                Replace portrait
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (live) {
                      setPending({ kind: 'replace', file });
                      return;
                    }
                    void replaceImage(file);
                  }}
                />
              </label>
            </div>
          </TextureCard>
        ) : (
          <p className="mb-4 text-xs text-muted-foreground">
            Select a portrait below, then press Start.
          </p>
        )}

        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="kpi-label">Library</p>
          <TextureButton
            variant="accent"
            size="sm"
            disabled={busy}
            onClick={() => setAdding(true)}
            contentClassName="gap-1.5 px-2.5 text-xs"
          >
            <Plus className="size-3.5" />
            Add persona
          </TextureButton>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {personas.map((persona) => {
            const selected = persona.id === activeId;
            return (
              <div key={persona.id} className="relative">
                <TextureButton
                  variant="minimal"
                  size="sm"
                  disabled={busy}
                  onClick={() => selectPersona(persona)}
                  className={`w-full overflow-hidden ${selected ? 'ring-2 ring-ring/50' : ''}`}
                  contentClassName="!block !h-auto !min-h-0 !p-0 text-left"
                >
                  {persona.imageUrl ? (
                    <img src={persona.imageUrl} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <span className="flex aspect-square items-center justify-center bg-panel text-muted-foreground">
                      ?
                    </span>
                  )}
                  <span className="block truncate px-2 py-1.5 text-xs font-medium text-foreground">
                    {persona.name}
                  </span>
                </TextureButton>
                {selected && (
                  <TextureButton
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => removePersona(persona)}
                    className="absolute right-1.5 top-1.5"
                    contentClassName="min-h-6 px-2 text-[10px]"
                  >
                    Delete
                  </TextureButton>
                )}
              </div>
            );
          })}
        </div>

        {!personas.length && !adding && (
          <p className="empty-panel mt-2 text-xs leading-snug text-muted-foreground">
            No persona yet. Add a portrait to create your first persona.
          </p>
        )}

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      <AddPersonaDialog
        open={adding}
        busy={busy}
        onClose={() => {
          if (!busy) setAdding(false);
        }}
        onSave={saveNewPersona}
      />

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.kind === 'replace'
            ? 'Replace this portrait?'
            : pending
              ? `Switch to ${pending.persona.name}?`
              : 'Switch persona?'
        }
        body="The current session will stop and restart with this portrait."
        confirmLabel="Restart session"
        busy={busy}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === 'replace') {
            void replaceImage(pending.file).then(() => setPending(null));
            return;
          }
          selectLocally(pending.persona);
          void applyLive(pending.persona);
        }}
      />
    </section>
  );
}
