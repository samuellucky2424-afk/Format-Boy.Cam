import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

function Settings() {
  const { user, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast.success('Profile updated successfully');
    setIsSaving(false);
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Settings</h1>
        <p className="text-sm text-[#a1a1aa]">Manage your account settings and preferences</p>
      </div>

      <div className="space-y-6">
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
                <Label className="text-sm font-medium text-white">Low Balance Alerts</Label>
                <p className="text-xs text-[#71717a]">Get notified when your balance is low</p>
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
