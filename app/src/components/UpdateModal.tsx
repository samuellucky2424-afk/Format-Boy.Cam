import { useEffect, useState } from 'react';
import { ShieldAlert, Download, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
      <DialogContent className="sm:max-w-[425px] bg-[#0f0f10] border-[#27272a] shadow-2xl shadow-black/50">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
            <Download className="w-6 h-6 text-blue-500" />
          </div>
          <DialogTitle className="text-xl text-center text-white font-bold tracking-tight">Update Available</DialogTitle>
          <DialogDescription className="text-center text-[#a1a1aa] pt-2">
            A new version of Format-Boy Cam is ready to install!
          </DialogDescription>
        </DialogHeader>
        
        <div className="bg-[#18181b] border border-amber-500/20 rounded-lg p-4 my-2 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-[#d4d4d8]">
            <p className="font-semibold text-white mb-1">Windows Defender Note</p>
            If Windows SmartScreen pops up during installation, safely click:
            <br />
            <span className="font-medium text-amber-400">More Info</span> → <span className="font-medium text-amber-400">Run Anyway</span>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4 sm:justify-between w-full">
          <Button 
            variant="outline" 
            onClick={() => setIsOpen(false)}
            className="sm:w-1/2 border-[#27272a] text-[#a1a1aa] hover:bg-[#27272a] hover:text-white"
          >
            Later
          </Button>
          <Button 
            onClick={handleInstall} 
            disabled={isInstalling}
            className="sm:w-1/2 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
          >
            {isInstalling ? (
              'Launching...'
            ) : (
              <>
                <Rocket className="w-4 h-4 mr-2" />
                Install Update
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
