import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { TextureButton } from '@/components/ui/texture-button';
import { TextureCard } from '@/components/ui/texture-card';
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
  const releaseNotes = updateState.notes
    ?.split(/\r?\n/)
    .filter((line) => !/\bsha-?256\b/i.test(line))
    .join('\n')
    .trim();

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account settings and preferences</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Desktop Updates</CardTitle>
            <CardDescription className="text-xs">Keep Henshin 変身 current without re-downloading the installer manually</CardDescription>
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
                    <RefreshCw className={`w-4 h-4 ${isUpdaterBusy ? 'text-blue-400 animate-spin' : 'text-muted-foreground'}`} />
                  )}
                  <p className="text-sm font-medium text-white">Update Status</p>
                </div>
                <p className="text-sm text-foreground/90">{updateState.message}</p>
                <p className="text-xs text-muted-foreground">Last checked: {checkedAtLabel}</p>
              </div>
              <TextureButton
                variant="accent"
                onClick={handleCheckForUpdates}
                disabled={!updateState.isElectron || isUpdaterBusy}
                className="sm:min-w-[190px]"
              >
                {isUpdaterBusy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : updateState.status === 'downloaded' ? (
                  <Rocket className="w-4 h-4 mr-2" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {getUpdateButtonLabel(updateState.status)}
              </TextureButton>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">Current Version</p>
                <p className="text-lg font-semibold text-white">{updateState.currentVersion}</p>
              </TextureCard>
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">Latest Version</p>
                <p className="text-lg font-semibold text-white">{updateState.latestVersion || 'Unknown'}</p>
              </TextureCard>
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">Install Mode</p>
                <p className="text-lg font-semibold text-white">
                  {updateState.canAutoInstall ? 'Automatic' : updateState.isElectron ? 'Download Only' : 'Browser'}
                </p>
              </TextureCard>
            </div>

            {(updateState.status === 'downloading' || updateState.status === 'installing' || updateState.status === 'downloaded') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Update progress</span>
                  <span>{Math.max(0, Math.min(100, updateState.progress))}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-border/70 bg-background/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, updateState.progress || 0))}%` }}
                  />
                </div>
              </div>
            )}

            {updateState.downloadedFileName && (
              <p className="text-xs text-muted-foreground">
                Downloaded package: <span className="text-foreground/90">{updateState.downloadedFileName}</span>
              </p>
            )}

            {releaseNotes && (
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">Release Notes</p>
                <p className="whitespace-pre-wrap text-sm text-foreground/90">{releaseNotes}</p>
              </TextureCard>
            )}

            {!updateState.isElectron && (
              <p className="text-xs text-muted-foreground">
                Open the Electron desktop app to check for updates, download new builds, and restart automatically.
              </p>
            )}

            {updateState.isElectron && !updateState.isPackaged && (
              <p className="text-xs text-muted-foreground">
                You&apos;re running the desktop app in development mode. Update checks work here, but automatic install is only enabled in packaged Windows builds.
              </p>
            )}

          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Profile Information</CardTitle>
            <CardDescription className="text-xs">Update your account details</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-muted-foreground">Full Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 bg-background/70"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-muted-foreground">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-background/70"
                />
              </div>
            </div>
            <CosmicButton
              as="button"
              onClick={handleSaveProfile}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </CosmicButton>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Notifications</CardTitle>
            <CardDescription className="text-xs">Configure your notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Email Notifications</Label>
                <p className="text-xs text-muted-foreground">Receive email updates about your account</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-border/70" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Low Credit Alerts</Label>
                <p className="text-xs text-muted-foreground">Get notified when your credits are low</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-border/70" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Marketing Emails</Label>
                <p className="text-xs text-muted-foreground">Receive updates about new features and offers</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">Danger Zone</CardTitle>
            <CardDescription className="text-xs">Irreversible actions</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">Sign Out</Label>
                <p className="text-xs text-muted-foreground">Sign out of your account on this device</p>
              </div>
              <TextureButton
                onClick={logout}
                variant="destructive"
              >
                Sign Out
              </TextureButton>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Settings;
