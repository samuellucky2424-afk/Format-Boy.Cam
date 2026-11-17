import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Users, CreditCard, Package, Check, X, Activity, Edit2, Plus } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { ROUTES } from '@/lib/routes';
import { getApiUrl } from '@/lib/api-client';

function withTimeout<T>(operation: PromiseLike<T>, label: string, timeoutMs = 12_000): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]);
}

export default function AdminDashboard() {
  const { user } = useAuth();
  
  const [payments, setPayments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  
  // Stats
  const [stats, setStats] = useState({
    totalUsers: 0,
    pendingPayments: 0,
    totalRevenue: 0
  });

  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [isAddCreditOpen, setIsAddCreditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [creditAmount, setCreditAmount] = useState('');

  const [isEditPackageOpen, setIsEditPackageOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  const [packageName, setPackageName] = useState('');
  const [packageUsd, setPackageUsd] = useState('');
  const [packageDuration, setPackageDuration] = useState('');

  const [isPaymentMethodOpen, setIsPaymentMethodOpen] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<any>(null);
  const [methodName, setMethodName] = useState('');
  const [methodCurrency, setMethodCurrency] = useState('');
  const [methodNetwork, setMethodNetwork] = useState('');
  const [methodAddress, setMethodAddress] = useState('');
  const [methodInstructions, setMethodInstructions] = useState('');
  const [methodQrFile, setMethodQrFile] = useState<File | null>(null);
  const [methodActive, setMethodActive] = useState(true);
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false);

  const getAdminAccessToken = async () => {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error || !session?.access_token) {
      throw new Error('Your session has expired. Please sign in again.');
    }
    return session.access_token;
  };

  const loadAdminPaymentMethods = async () => {
    const accessToken = await getAdminAccessToken();
    const response = await fetch(getApiUrl('/payment-methods?includeInactive=true'), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not load payment methods.');
    return { data: result.paymentMethods || [], error: null };
  };

  const savePaymentMethod = async (values: Record<string, unknown>, id?: string) => {
    const accessToken = await getAdminAccessToken();
    const response = await fetch(getApiUrl('/payment-methods'), {
      method: id ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(id ? { ...values, id } : values),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save the payment method.');
    if (!result.paymentMethod?.id) throw new Error('The server did not confirm the saved payment method.');
    return result.paymentMethod;
  };

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      // Load the primary payment table independently so optional dashboard
      // datasets can never hold valid pending payments behind a spinner.
      const paymentsRes = await withTimeout(
        supabase.from('crypto_payments').select('*').order('created_at', { ascending: false }),
        'Pending payments',
      );
      if (paymentsRes.error) throw paymentsRes.error;

      const optionalResults = await Promise.allSettled([
        withTimeout(supabase.from('transactions').select('*').order('created_at', { ascending: false }), 'Website transactions'),
        withTimeout(supabase.from('users').select('*').order('created_at', { ascending: false }), 'Users'),
        withTimeout(supabase.from('credit_packages').select('*').order('sort_order', { ascending: true }), 'Access plans'),
        withTimeout(loadAdminPaymentMethods(), 'Payment methods'),
      ]);

      optionalResults.forEach(result => {
        if (result.status === 'rejected') console.warn(result.reason);
      });

      const optionalValue = (index: number): any => {
        const result = optionalResults[index];
        return result.status === 'fulfilled' ? result.value : { data: [], error: result.reason };
      };
      const websiteTransactionsRes = optionalValue(0);
      const usersRes = optionalValue(1);
      const packagesRes = optionalValue(2);
      const methodsRes = optionalValue(3);

      const usersById = new Map((usersRes.data || []).map(account => [account.id, account]));
      const packagesById = new Map((packagesRes.data || []).map(pkg => [pkg.id, pkg]));

      const cryptoPayments = (paymentsRes.data || []).map(payment => ({
        ...payment,
        source: 'crypto',
        users: usersById.get(payment.user_id),
        credit_packages: packagesById.get(payment.package_id),
      }));
      const websitePayments = (websiteTransactionsRes.data || []).map(transaction => ({
        ...transaction,
        source: 'website',
        users: usersById.get(transaction.user_id),
        currency: transaction.metadata?.currency || 'NGN',
        status: transaction.status === 'success' ? 'completed' : transaction.status,
        crypto_currency: transaction.provider || 'Website',
      }));
      const combinedPayments = [...cryptoPayments, ...websitePayments]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPayments(combinedPayments);
      if (usersRes.data) setUsers(usersRes.data);
      if (packagesRes.data) setPackages(packagesRes.data);
      if (methodsRes.data) setPaymentMethods(methodsRes.data);

      setStats({
        totalUsers: usersRes.data?.length || 0,
        pendingPayments: combinedPayments.filter(p => p.status === 'pending').length,
        totalRevenue: combinedPayments.filter(p => p.status === 'completed').reduce((acc, curr) => acc + Number(curr.amount), 0)
      });
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  if (!user?.isAdmin) {
    return <Navigate to={ROUTES.PROTECTED.DASHBOARD} replace />;
  }

  const handleConfirmPayment = async (payment: any) => {
    try {
      const { error } = payment.source === 'website'
        ? await supabase.rpc('admin_confirm_website_transaction', {
            p_transaction_id: payment.id,
            p_status: 'completed'
          })
        : await supabase.rpc('admin_confirm_payment', {
            p_payment_id: payment.id,
            p_status: 'completed'
          });
      if (error) throw error;
      toast.success('Payment confirmed and access granted');
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Error confirming payment');
    }
  };

  const handleDeclinePayment = async (payment: any) => {
    try {
      const { error } = payment.source === 'website'
        ? await supabase.rpc('admin_confirm_website_transaction', {
            p_transaction_id: payment.id,
            p_status: 'failed'
          })
        : await supabase.rpc('admin_confirm_payment', {
            p_payment_id: payment.id,
            p_status: 'failed'
          });
      if (error) throw error;
      toast.success('Payment declined');
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Error declining payment');
    }
  };

  const handleAddCreditsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !creditAmount) return;

    try {
      const { error } = await supabase.rpc('admin_add_credits', {
        p_user_id: selectedUser.id,
        p_amount: Number(creditAmount)
      });
      if (error) throw error;
      toast.success(`Successfully added ${creditAmount} credits to ${selectedUser.email}`);
      setIsAddCreditOpen(false);
      setCreditAmount('');
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Error adding credits');
    }
  };

  const handleEditPackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceUsd = Number(packageUsd);
    const durationDays = packageDuration.trim() === '' ? null : Number(packageDuration);

    if (!selectedPackage) {
      toast.error('Only the three existing plans can be edited.');
      return;
    }
    if (!packageName.trim() || !Number.isFinite(priceUsd) || priceUsd <= 0) {
      toast.error('Enter a name and a price in dollars.');
      return;
    }
    if (selectedPackage.plan_code === 'unlimited' && durationDays !== null) {
      toast.error('The unlimited plan does not expire. Leave the access length blank.');
      return;
    }
    if (selectedPackage.plan_code !== 'unlimited' && (durationDays === null || !Number.isInteger(durationDays) || durationDays <= 0)) {
      toast.error('Enter the number of days this plan stays active.');
      return;
    }

    try {
      const packageValues = {
        name: packageName.trim(),
        credits: 0,
        price_usd: priceUsd,
        price_ngn: 0,
        duration_days: selectedPackage.plan_code === 'unlimited' ? null : durationDays,
        is_active: true,
      };

      const { error } = await supabase.from('credit_packages').update(packageValues).eq('id', selectedPackage.id);
      
      if (error) throw error;
      toast.success('Plan updated');
      setIsEditPackageOpen(false);
      setSelectedPackage(null);
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Error updating package');
    }
  };

  const openPaymentMethodDialog = (method?: any) => {
    setSelectedPaymentMethod(method || null);
    setMethodName(method?.name || '');
    setMethodCurrency(method?.crypto_currency || '');
    setMethodNetwork(method?.network || '');
    setMethodAddress(method?.wallet_address || '');
    setMethodInstructions(method?.instructions || '');
    setMethodQrFile(null);
    setMethodActive(method?.is_active ?? true);
    setIsPaymentMethodOpen(true);
  };

  const handlePaymentMethodSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!methodName.trim() || !methodCurrency.trim() || !methodNetwork.trim() || !methodAddress.trim()) {
      toast.error('Name, currency, network, and wallet address are required.');
      return;
    }

    setIsSavingPaymentMethod(true);
    try {
      const values = {
        name: methodName.trim(),
        crypto_currency: methodCurrency.trim().toUpperCase(),
        network: methodNetwork.trim(),
        wallet_address: methodAddress.trim(),
        instructions: methodInstructions.trim() || null,
        qr_code_url: selectedPaymentMethod?.qr_code_url || null,
        is_active: methodActive,
      };

      let savedMethod = await savePaymentMethod(values, selectedPaymentMethod?.id);
      let qrUploadWarning = '';

      if (methodQrFile) {
        try {
          const extension = methodQrFile.name.split('.').pop()?.toLowerCase() || 'png';
          const objectPath = `payment-methods/${savedMethod.id}-${Date.now()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from('payment-qr-codes')
            .upload(objectPath, methodQrFile, { contentType: methodQrFile.type, upsert: false });
          if (uploadError) throw uploadError;

          const qrCodeUrl = supabase.storage.from('payment-qr-codes').getPublicUrl(objectPath).data.publicUrl;
          savedMethod = await savePaymentMethod(
            { ...values, qr_code_url: qrCodeUrl },
            savedMethod.id,
          );
        } catch (error) {
          console.error('Payment QR upload failed after the wallet was saved:', error);
          qrUploadWarning = ' The wallet was stored, but its QR image could not be linked; you can retry it from Edit.';
        }
      }

      toast.success(
        `${selectedPaymentMethod ? 'Payment method updated' : 'Payment method added'} and stored.${qrUploadWarning}`,
      );
      setIsPaymentMethodOpen(false);
      setSelectedPaymentMethod(null);
      await fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save payment method');
    } finally {
      setIsSavingPaymentMethod(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Admin Dashboard</h1>
          <p className="text-[#a1a1aa] mt-1">Manage users, view payments, and configure packages.</p>
        </div>
        <Button variant="outline" className="border-[#27272a] bg-[#18181b] text-white hover:bg-[#27272a]" onClick={fetchDashboardData} disabled={isLoading}>
          <Activity className="w-4 h-4 mr-2" /> Refresh Data
        </Button>
      </div>
      
      {/* Metrics Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-[#a1a1aa]">Total Users</CardTitle>
            <Users className="w-4 h-4 text-[#71717a]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{stats.totalUsers}</div>
          </CardContent>
        </Card>
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-[#a1a1aa]">Pending Payments</CardTitle>
            <CreditCard className="w-4 h-4 text-[#71717a]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{stats.pendingPayments}</div>
            <p className="text-xs text-[#a1a1aa] mt-1">Awaiting confirmation</p>
          </CardContent>
        </Card>
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-[#a1a1aa]">Total Revenue (Crypto)</CardTitle>
            <Activity className="w-4 h-4 text-[#71717a]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">${stats.totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-[#a1a1aa] mt-1">From confirmed payments</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="payments" className="w-full">
        <TabsList className="bg-[#18181b] border border-[#27272a] p-1 mb-6">
          <TabsTrigger value="payments" className="data-[state=active]:bg-[#27272a] data-[state=active]:text-white">
            <CreditCard className="w-4 h-4 mr-2" /> Pending Payments
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-[#27272a] data-[state=active]:text-white">
            <Users className="w-4 h-4 mr-2" /> Users Directory
          </TabsTrigger>
          <TabsTrigger value="packages" className="data-[state=active]:bg-[#27272a] data-[state=active]:text-white">
            <Package className="w-4 h-4 mr-2" /> Credit Packages
          </TabsTrigger>
          <TabsTrigger value="payment-methods" className="data-[state=active]:bg-[#27272a] data-[state=active]:text-white">
            <CreditCard className="w-4 h-4 mr-2" /> Payment Setup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <Card className="bg-[#18181b] border-[#27272a]">
            <CardHeader>
              <CardTitle className="text-white">Crypto Payments</CardTitle>
              <CardDescription className="text-[#a1a1aa]">Review and confirm manual USDT transfers.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-[#27272a] overflow-hidden">
                <Table>
                  <TableHeader className="bg-[#1a1a1c]">
                    <TableRow className="border-[#27272a] hover:bg-transparent">
                      <TableHead className="text-[#a1a1aa]">User</TableHead>
                      <TableHead className="text-[#a1a1aa]">Amount</TableHead>
                      <TableHead className="text-[#a1a1aa]">Credits</TableHead>
                      <TableHead className="text-[#a1a1aa]">Status</TableHead>
                      <TableHead className="text-right text-[#a1a1aa]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.length === 0 ? (
                       <TableRow className="border-[#27272a] hover:bg-transparent">
                          <TableCell colSpan={5} className="h-24 text-center text-[#71717a]">
                            No payments found.
                          </TableCell>
                       </TableRow>
                    ) : (
                      payments.map(p => (
                        <TableRow key={p.id} className="border-[#27272a] hover:bg-[#27272a]/50">
                          <TableCell className="font-medium text-white">
                            <div>{p.users?.name || 'Unknown'}</div>
                            <div className="text-xs text-[#71717a] font-normal">{p.users?.email}</div>
                          </TableCell>
                          <TableCell className="text-[#e4e4e7]">
                            <div>{p.currency === 'USD' ? '$' : '₦'}{p.amount}</div>
                            <div className="text-xs text-[#71717a]">{p.source === 'website' ? 'Website' : 'Desktop'}</div>
                          </TableCell>
                          <TableCell className="text-[#e4e4e7]">{p.credits}</TableCell>
                          <TableCell>
                            <Badge variant={p.status === 'pending' ? 'outline' : 'default'} className={
                              p.status === 'pending' ? 'border-yellow-500/50 text-yellow-500 bg-yellow-500/10' :
                              p.status === 'completed' ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10' :
                              'border-red-500/50 text-red-500 bg-red-500/10'
                            }>
                              {p.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {p.status === 'pending' && (
                              <div className="flex justify-end gap-2">
                                <Button size="sm" onClick={() => handleConfirmPayment(p)} className="bg-emerald-600/20 text-emerald-500 hover:bg-emerald-600/30">
                                  <Check className="w-4 h-4 mr-1" /> Confirm
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeclinePayment(p)} className="text-red-500 hover:bg-red-500/10 hover:text-red-400">
                                  <X className="w-4 h-4 mr-1" /> Decline
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card className="bg-[#18181b] border-[#27272a]">
            <CardHeader>
              <CardTitle className="text-white">User Directory</CardTitle>
              <CardDescription className="text-[#a1a1aa]">View all registered users and manage their credits.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-[#27272a] overflow-hidden">
                <Table>
                  <TableHeader className="bg-[#1a1a1c]">
                    <TableRow className="border-[#27272a] hover:bg-transparent">
                      <TableHead className="text-[#a1a1aa]">Name</TableHead>
                      <TableHead className="text-[#a1a1aa]">Email</TableHead>
                      <TableHead className="text-[#a1a1aa]">Balance</TableHead>
                      <TableHead className="text-[#a1a1aa]">Role</TableHead>
                      <TableHead className="text-right text-[#a1a1aa]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(u => (
                      <TableRow key={u.id} className="border-[#27272a] hover:bg-[#27272a]/50">
                        <TableCell className="font-medium text-white">{u.name || 'Unknown'}</TableCell>
                        <TableCell className="text-[#a1a1aa]">{u.email}</TableCell>
                        <TableCell className="text-[#e4e4e7]">{Array.isArray(u.wallets) ? u.wallets[0]?.credits || 0 : u.wallets?.credits || 0} credits</TableCell>
                        <TableCell>
                          {u.is_admin ? (
                            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Admin</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[#71717a] border-[#3f3f46]">User</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="border-[#3f3f46] hover:bg-[#27272a] text-white"
                            onClick={() => {
                              setSelectedUser(u);
                              setCreditAmount('');
                              setIsAddCreditOpen(true);
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" /> Add Credits
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packages">
          <Card className="bg-[#18181b] border-[#27272a]">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-white">Access plans</CardTitle>
                <CardDescription className="text-[#a1a1aa]">$100 for 14 days, $250 for 30 days, and $500 with no expiry.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-[#27272a] overflow-hidden">
                <Table>
                  <TableHeader className="bg-[#1a1a1c]">
                    <TableRow className="border-[#27272a] hover:bg-transparent">
                      <TableHead className="text-[#a1a1aa]">Plan</TableHead>
                      <TableHead className="text-[#a1a1aa]">Access</TableHead>
                      <TableHead className="text-[#a1a1aa]">Price (USD)</TableHead>
                      <TableHead className="text-right text-[#a1a1aa]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packages.filter((pkg) => pkg.is_active !== false).map(pkg => (
                      <TableRow key={pkg.id} className="border-[#27272a] hover:bg-[#27272a]/50">
                        <TableCell className="font-medium text-white">{pkg.name}</TableCell>
                        <TableCell className="text-[#e4e4e7]">{pkg.plan_code === 'unlimited' || pkg.duration_days == null ? 'No expiry' : `${pkg.duration_days} days`}</TableCell>
                        <TableCell className="text-[#a1a1aa]">${pkg.price_usd || 0}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="border-[#3f3f46] hover:bg-[#27272a] text-white"
                            onClick={() => {
                              setSelectedPackage(pkg);
                              setPackageName(pkg.name || '');
                              setPackageUsd(pkg.price_usd?.toString() || '0');
                              setPackageDuration(pkg.duration_days == null ? '' : String(pkg.duration_days));
                              setIsEditPackageOpen(true);
                            }}
                          >
                            <Edit2 className="w-3 h-3 mr-1" /> Edit Package
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payment-methods">
          <Card className="bg-[#18181b] border-[#27272a]">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-white">Payment Methods</CardTitle>
                <CardDescription className="text-[#a1a1aa]">Wallet addresses, networks, and QR codes shared with the website.</CardDescription>
              </div>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => openPaymentMethodDialog()}>
                <Plus className="w-4 h-4 mr-2" /> Add Payment Method
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {paymentMethods.length === 0 ? (
                  <div className="col-span-full py-10 text-center text-[#71717a]">No payment methods configured.</div>
                ) : paymentMethods.map(method => (
                  <div key={method.id} className="rounded-xl border border-[#27272a] bg-[#131316] p-4 flex gap-4">
                    {method.qr_code_url ? (
                      <img src={method.qr_code_url} alt={`${method.name} QR code`} className="w-24 h-24 rounded-lg bg-white object-contain p-1" />
                    ) : (
                      <div className="w-24 h-24 rounded-lg bg-[#27272a] flex items-center justify-center text-xs text-[#71717a] text-center">No QR image</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-white">{method.name}</h3>
                        <Badge className={method.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-500/20 text-zinc-400'}>
                          {method.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-sm text-[#a1a1aa] mt-1">{method.crypto_currency} · {method.network}</p>
                      <p className="text-xs text-[#71717a] mt-2 break-all">{method.wallet_address}</p>
                      <Button variant="outline" size="sm" className="mt-3 border-[#3f3f46] text-white" onClick={() => openPaymentMethodDialog(method)}>
                        <Edit2 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Credits Modal */}
      <Dialog open={isAddCreditOpen} onOpenChange={setIsAddCreditOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Credits</DialogTitle>
            <DialogDescription className="text-[#a1a1aa]">
              Manually add credits to {selectedUser?.email}'s wallet.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCreditsSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[#e4e4e7]">Credit Amount</label>
                <Input 
                  type="number"
                  min="1"
                  required
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="bg-[#27272a] border-[#3f3f46] text-white"
                  placeholder="e.g. 500"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddCreditOpen(false)} className="border-[#3f3f46] bg-transparent text-white hover:bg-[#27272a]">
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
                Add Credits
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Package Modal */}
      <Dialog open={isEditPackageOpen} onOpenChange={setIsEditPackageOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit access plan</DialogTitle>
            <DialogDescription className="text-[#a1a1aa]">
              Leave access length blank for the $500 plan, which does not expire.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditPackageSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[#e4e4e7]">Package Name</label>
                <Input
                  required
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  className="bg-[#27272a] border-[#3f3f46] text-white"
                  placeholder="2 Weeks"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[#e4e4e7]">Access length in days</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={packageDuration}
                  onChange={(e) => setPackageDuration(e.target.value)}
                  placeholder="Blank means no expiry"
                  className="bg-[#27272a] border-[#3f3f46] text-white"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-[#e4e4e7]">Price in USD ($)</label>
                <Input 
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={packageUsd}
                  onChange={(e) => setPackageUsd(e.target.value)}
                  className="bg-[#27272a] border-[#3f3f46] text-white"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditPackageOpen(false)} className="border-[#3f3f46] bg-transparent text-white hover:bg-[#27272a]">
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
                Save plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isPaymentMethodOpen} onOpenChange={setIsPaymentMethodOpen}>
        <DialogContent className="bg-[#18181b] border-[#27272a] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedPaymentMethod ? 'Edit Payment Method' : 'Add Payment Method'}</DialogTitle>
            <DialogDescription className="text-[#a1a1aa]">These details are available to both the website and desktop checkout.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePaymentMethodSubmit}>
            <div className="grid gap-4 py-4">
              <Input required value={methodName} onChange={e => setMethodName(e.target.value)} placeholder="Display name, e.g. USDT ERC20" className="bg-[#27272a] border-[#3f3f46] text-white" />
              <div className="grid grid-cols-2 gap-3">
                <Input required value={methodCurrency} onChange={e => setMethodCurrency(e.target.value)} placeholder="Currency, e.g. USDT" className="bg-[#27272a] border-[#3f3f46] text-white" />
                <Input required value={methodNetwork} onChange={e => setMethodNetwork(e.target.value)} placeholder="Network, e.g. ERC20" className="bg-[#27272a] border-[#3f3f46] text-white" />
              </div>
              <Input required value={methodAddress} onChange={e => setMethodAddress(e.target.value)} placeholder="Wallet address" className="bg-[#27272a] border-[#3f3f46] text-white" />
              <Input value={methodInstructions} onChange={e => setMethodInstructions(e.target.value)} placeholder="Optional payment instructions" className="bg-[#27272a] border-[#3f3f46] text-white" />
              <div className="grid gap-2">
                <label className="text-sm text-[#e4e4e7]">QR code image (PNG, JPG, or WebP; max 5MB)</label>
                <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setMethodQrFile(e.target.files?.[0] || null)} className="bg-[#27272a] border-[#3f3f46] text-white file:text-white" />
              </div>
              <label className="flex items-center gap-2 text-sm text-[#e4e4e7]">
                <input type="checkbox" checked={methodActive} onChange={e => setMethodActive(e.target.checked)} className="h-4 w-4" />
                Active and visible to customers
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsPaymentMethodOpen(false)} disabled={isSavingPaymentMethod} className="border-[#3f3f46] bg-transparent text-white">Cancel</Button>
              <Button type="submit" disabled={isSavingPaymentMethod} className="bg-blue-600 hover:bg-blue-700 text-white">
                {isSavingPaymentMethod ? 'Saving...' : 'Save Payment Method'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
