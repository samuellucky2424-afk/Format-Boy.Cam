import { useEffect, useState } from 'react';
import { ShieldAlert, Download, Rocket } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureButton } from '@/components/ui/texture-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { subscribeToDesktopUpdateState, installDesktopUpdate } from '@/lib/desktop-updater';
import { toast } from 'sonner';

export function UpdateModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToDesktopUpdateState((state) => {
      // Show modal when the update is successfully downloaded and waiting to install
      if (state.status === 'downloaded' && !isInstalling) {
        setIsOpen(true);
      }
    });

    return unsubscribe;
  }, [isInstalling]);

  const handleInstall = async () => {
    try {
      setIsInstalling(true);
      await installDesktopUpdate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to install update');
      setIsInstalling(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border shadow-surface">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <Download className="w-6 h-6 text-blue-400" />
          </div>
          <DialogTitle className="text-xl text-center text-foreground font-bold tracking-tight">Update Available</DialogTitle>
          <DialogDescription className="text-center text-muted-foreground pt-2">
            A new version of Henshin 変身 is ready to install!
          </DialogDescription>
        </DialogHeader>
        
        <div className="bg-panel border border-blue-500/20 rounded-lg p-4 my-2 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">Windows Defender Note</p>
            If Windows SmartScreen pops up during installation, safely click:
            <br />
            <span className="font-medium text-blue-400">More Info</span> → <span className="font-medium text-blue-400">Run Anyway</span>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4 sm:justify-between w-full">
          <TextureButton
            variant="minimal"
            onClick={() => setIsOpen(false)}
            className="sm:w-1/2"
          >
            Later
          </TextureButton>
          <CosmicButton
            as="button"
            onClick={handleInstall} 
            disabled={isInstalling}
            className="sm:w-1/2"
          >
            {isInstalling ? (
              'Launching...'
            ) : (
              <>
                <Rocket className="w-4 h-4 mr-2" />
                Install Update
              </>
            )}
          </CosmicButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
