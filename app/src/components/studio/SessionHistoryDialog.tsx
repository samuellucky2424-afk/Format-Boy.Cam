import { Activity, Clock3, Coins } from 'lucide-react';
import type { SessionHistoryEntry } from '@/context/AppContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safeSeconds / 60)}m ${safeSeconds % 60}s`;
}

function statusTone(status: SessionHistoryEntry['status']) {
  if (status === 'active') return 'bg-blue-400';
  if (status === 'ended') return 'bg-emerald-400';
  return 'bg-amber-400';
}

export function SessionHistoryDialog({
  open,
  onOpenChange,
  sessions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionHistoryEntry[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] max-w-3xl overflow-hidden border-blue-500/20 bg-background/95 p-0 backdrop-blur-xl">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Activity className="size-5 text-primary" />
            Session history
          </DialogTitle>
          <DialogDescription>
            Usage recorded for this account, correlated with Reactor when a provider ID is available.
          </DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar min-h-0 overflow-y-auto px-3 pb-4 sm:px-6">
          {sessions.length === 0 ? (
            <div className="rounded-2xl border border-blue-500/15 bg-panel/50 px-6 py-12 text-center text-sm text-muted-foreground">
              No live session has been recorded yet.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <article
                  key={session.id}
                  className="rounded-2xl border border-blue-500/15 bg-panel/45 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`size-1.5 rounded-full ${statusTone(session.status)}`} />
                        <p className="text-sm font-semibold text-foreground">
                          {session.provider === 'reactor'
                            ? 'Reactor X2'
                            : session.provider === 'fal'
                              ? 'fal.ai Lucy 2.5'
                              : 'Morphly (Historical)'}
                        </p>
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {session.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(session.date).toLocaleString()}
                      </p>
                    </div>
                    <p className="text-right text-lg font-semibold tabular-nums text-foreground">
                      {session.credits.toLocaleString()} cr
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-background/45 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Clock3 className="size-3" /> Duration
                      </p>
                      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {formatDuration(session.duration)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-background/45 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Coins className="size-3" /> Rate
                      </p>
                      <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                        {session.rate} cr/s
                      </p>
                    </div>
                    <div className="col-span-2 rounded-xl bg-background/45 px-3 py-2 sm:col-span-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</p>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">
                        {session.reason || (session.status === 'active' ? 'Live now' : 'Completed')}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground/70">
                    Provider: {session.providerSessionId || 'not assigned'} · Henshin: {session.id}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
