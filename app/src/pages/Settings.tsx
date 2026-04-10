import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { CURRENT_VERSION } from '@/lib/app-version';
import {
  checkForDesktopUpdates,
  getDesktopUpdateState,
  installDesktopUpdate,
  subscribeToDesktopUpdateState,
  type DesktopUpdateState,
  type DesktopUpdateStatus,
} from '@/lib/desktop-updater';
import { toast } from 'sonner';

const INITIAL_UPDATE_STATE: DesktopUpdateState = {
  status: 'idle',
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  progress: 0,
  message: 'Checking desktop updater availability...',
  checkedAt: null,
  downloadUrl: null,
  downloadedFilePath: null,
  downloadedFileName: null,
  artifactType: null,
  notes: null,
  error: null,
  isElectron: false,
  isPackaged: false,
  canAutoInstall: false,
};

function getUpdateButtonLabel(status: DesktopUpdateStatus): string {
  switch (status) {
    case 'checking':
      return 'Checking...';
    case 'downloading':
      return 'Downloading...';
    case 'installing':
      return 'Installing...';
    case 'downloaded':
      return 'Restart to Install';
    default:
      return 'Check for Updates';
  }
}

function Settings() {
  const { user, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isSaving, setIsSaving] = useState(false);
  const [updateState, setUpdateState] = useState<DesktopUpdateState>(INITIAL_UPDATE_STATE);
  const previousUpdateStatusRef = useRef<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    let isMounted = true;

    void getDesktopUpdateState().then((state) => {
      if (isMounted) {
        setUpdateState(state);
      }
    });

    const unsubscribe = subscribeToDesktopUpdateState((state) => {
      if (isMounted) {
        setUpdateState(state);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const previousStatus = previousUpdateStatusRef.current;

    if (previousStatus === updateState.status) {
      return;
    }

    if (previousStatus === 'checking' && updateState.status === 'up-to-date') {
      toast.success(updateState.message);
    } else if (updateState.status === 'downloaded') {
      toast.success(updateState.message);
    } else if (updateState.status === 'installing') {
      toast.message('Installing the latest desktop update and restarting...');
    } else if (updateState.status === 'error' && updateState.error) {
      toast.error(updateState.error);
    }

    previousUpdateStatusRef.current = updateState.status;
  }, [updateState.error, updateState.message, updateState.status]);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast.success('Profile updated successfully');
    setIsSaving(false);
  };

  const handleCheckForUpdates = async () => {
    try {
      if (updateState.status === 'downloaded') {
        await installDesktopUpdate();
        return;
      }

      await checkForDesktopUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete desktop update.';
      toast.error(message);
    }
  };

  const isUpdaterBusy =
    updateState.status === 'checking' ||
    updateState.status === 'downloading' ||
    updateState.status === 'installing';

  const checkedAtLabel = updateState.checkedAt
    ? new Date(updateState.checkedAt).toLocaleString()
    : 'Not checked yet';

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Settings</h1>
        <p className="text-sm text-[#a1a1aa]">Manage your account settings and preferences</p>
      </div>

      <div className="space-y-6">
        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
          <CardHeader className="border-b border-[#1f1f23]">
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Desktop Updates</CardTitle>
            <CardDescription className="text-xs text-[#71717a]">Keep Format-Boy Cam current without re-downloading the installer manually</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {updateState.status === 'downloaded' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : updateState.status === 'installing' ? (
                    <Rocket className="w-4 h-4 text-blue-400" />
                  ) : (
                    <RefreshCw className={`w-4 h-4 ${isUpdaterBusy ? 'text-blue-400 animate-spin' : 'text-[#71717a]'}`} />
                  )}
                  <p className="text-sm font-medium text-white">Update Status</p>
                </div>
                <p className="text-sm text-[#d4d4d8]">{updateState.message}</p>
                <p className="text-xs text-[#71717a]">Last checked: {checkedAtLabel}</p>
              </div>
              <Button
                onClick={handleCheckForUpdates}
                disabled={!updateState.isElectron || isUpdaterBusy}
                className="sm:min-w-[190px] bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                {isUpdaterBusy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : updateState.status === 'downloaded' ? (
                  <Rocket className="w-4 h-4 mr-2" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {getUpdateButtonLabel(updateState.status)}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#71717a] mb-2">Current Version</p>
                <p className="text-lg font-semibold text-white">{updateState.currentVersion}</p>
              </div>
              <div className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#71717a] mb-2">Latest Version</p>
                <p className="text-lg font-semibold text-white">{updateState.latestVersion || 'Unknown'}</p>
              </div>
              <div className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#71717a] mb-2">Install Mode</p>
                <p className="text-lg font-semibold text-white">
                  {updateState.canAutoInstall ? 'Automatic' : updateState.isElectron ? 'Download Only' : 'Browser'}
                </p>
              </div>
            </div>

            {(updateState.status === 'downloading' || updateState.status === 'installing' || updateState.status === 'downloaded') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#71717a]">
                  <span>Update progress</span>
                  <span>{Math.max(0, Math.min(100, updateState.progress))}%</span>
                </div>
                <div className="h-2 rounded-full bg-[#18181b] border border-[#27272a] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, updateState.progress || 0))}%` }}
                  />
                </div>
              </div>
            )}

            {updateState.downloadedFileName && (
              <p className="text-xs text-[#71717a]">
                Downloaded package: <span className="text-[#d4d4d8]">{updateState.downloadedFileName}</span>
              </p>
            )}

            {updateState.notes && (
              <div className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#71717a] mb-2">Release Notes</p>
                <p className="text-sm text-[#d4d4d8] whitespace-pre-wrap">{updateState.notes}</p>
              </div>
            )}

            {!updateState.isElectron && (
              <p className="text-xs text-[#71717a]">
                Open the Electron desktop app to check for updates, download new builds, and restart automatically.
              </p>
            )}

            {updateState.isElectron && !updateState.isPackaged && (
              <p className="text-xs text-[#71717a]">
                You&apos;re running the desktop app in development mode. Update checks work here, but automatic install is only enabled in packaged Windows builds.
              </p>
            )}

            {updateState.downloadUrl && (
              <p className="text-xs text-[#71717a] break-all">
                Update source: {updateState.downloadUrl}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
          <CardHeader className="border-b border-[#1f1f23]">
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Profile Information</CardTitle>
            <CardDescription className="text-xs text-[#71717a]">Update your account details</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-[#a1a1aa]">Full Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 bg-[#18181b] border-[#27272a] text-white focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-[#a1a1aa]">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-[#18181b] border-[#27272a] text-white focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
            <Button 
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
          <CardHeader className="border-b border-[#1f1f23]">
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Notifications</CardTitle>
            <CardDescription className="text-xs text-[#71717a]">Configure your notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Email Notifications</Label>
                <p className="text-xs text-[#71717a]">Receive email updates about your account</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-[#27272a]" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Low Credit Alerts</Label>
                <p className="text-xs text-[#71717a]">Get notified when your credits are low</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-[#27272a]" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Marketing Emails</Label>
                <p className="text-xs text-[#71717a]">Receive updates about new features and offers</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
          <CardHeader className="border-b border-[#1f1f23]">
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Danger Zone</CardTitle>
            <CardDescription className="text-xs text-[#71717a]">Irreversible actions</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Sign Out</Label>
                <p className="text-xs text-[#71717a]">Sign out of your account on this device</p>
              </div>
              <Button 
                onClick={logout}
                variant="outline"
                className="border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]"
              >
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Settings;
