import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Activity,
  Check,
  Clipboard,
  CreditCard,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TextureButton as Button } from '@/components/ui/texture-button';

type ProLicense = {
  id: string;
  user_id: string;
  status: 'pending' | 'active' | 'revoked';
  credits_per_second: number;
  code_last4: string;
  redeemed_at?: string | null;
  updated_at?: string;
  user?: { email?: string; name?: string } | null;
};

type Client = {
  id: string;
  email: string;
  name?: string;
  is_admin?: boolean;
  credits: number;
  proLicense?: ProLicense | null;
};

type Payment = {
  id: string;
  user_id: string;
  source: 'crypto' | 'website';
  amount: number;
  currency?: string;
  credits?: number;
  status: string;
  provider_status?: string;
  reference?: string;
  created_at: string;
  user?: { email?: string; name?: string } | null;
};

type UsageRow = {
  id: string;
  provider: string;
  model?: string;
  seconds_used: number;
  credits_used: number;
  credits_per_second: number;
  providerCostUsd?: number | null;
  start_time: string;
  user?: { email?: string; name?: string } | null;
};

type AuditRow = {
  id: string;
  action: string;
  reason: string;
  actor_user_id: string;
  target_user_id?: string | null;
  created_at: string;
};

type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price_usd: number;
  price_xaf: number;
  is_active: boolean;
};

type Overview = {
  totalUsers: number;
  totalCredits: number;
  activeProLicenses: number;
  pendingProLicenses: number;
  pendingPayments: number;
  revenueByCurrency: Record<string, number>;
  usageByProvider: Record<string, { sessions: number; seconds: number; credits: number; providerCostUsd: number }>;
};

type Mutation =
  | { kind: 'credits'; client: Client }
  | { kind: 'create-license'; client: Client }
  | { kind: 'license'; license: ProLicense; action: 'set_rate' | 'revoke' | 'reactivate' }
  | { kind: 'payment'; payment: Payment; status: 'completed' | 'failed' }
  | { kind: 'package'; package?: CreditPackage };

const EMPTY_OVERVIEW: Overview = {
  totalUsers: 0,
  totalCredits: 0,
  activeProLicenses: 0,
  pendingProLicenses: 0,
  pendingPayments: 0,
  revenueByCurrency: {},
  usageByProvider: {},
};

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Admin request failed.');
  return body as T;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${safe % 60}s`;
}

function licenseTone(status?: string) {
  if (status === 'active') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
  if (status === 'pending') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-red-500/40 bg-red-500/10 text-red-400';
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [clients, setClients] = useState<Client[]>([]);
  const [licenses, setLicenses] = useState<ProLicense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [query, setQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('pending');
  const [mutation, setMutation] = useState<Mutation | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('80');
  const [packageName, setPackageName] = useState('');
  const [packageCredits, setPackageCredits] = useState('');
  const [packageUsd, setPackageUsd] = useState('');
  const [packageXaf, setPackageXaf] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);

  const loadData = useCallback(async (usagePeriod = period) => {
    setLoading(true);
    try {
      const [overviewData, clientData, licenseData, paymentData, usageData, auditData, packageData] = await Promise.all([
        adminRequest<Overview>('/admin?action=overview'),
        adminRequest<{ clients: Client[] }>('/admin?action=clients'),
        adminRequest<{ licenses: ProLicense[] }>('/admin?action=licenses'),
        adminRequest<{ rows: Payment[] }>('/admin?action=payments'),
        adminRequest<{ rows: UsageRow[] }>(`/admin?action=usage&period=${usagePeriod}`),
        adminRequest<{ audit: AuditRow[] }>('/admin?action=audit'),
        adminRequest<{ packages: CreditPackage[] }>('/admin?action=packages'),
      ]);
      setOverview(overviewData);
      setClients(clientData.clients);
      setLicenses(licenseData.licenses);
      setPayments(paymentData.rows);
      setUsage(usageData.rows);
      setAudit(auditData.audit);
      setPackages(packageData.packages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load administration data.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadData]);

  if (!user?.isAdmin) return <Navigate to={ROUTES.PROTECTED.DASHBOARD} replace />;

  const openMutation = (next: Mutation) => {
    setMutation(next);
    setReason('');
    setAmount('');
    if (next.kind === 'create-license') setRate('80');
    if (next.kind === 'license') setRate(String(next.license.credits_per_second));
    if (next.kind === 'package') {
      setPackageName(next.package?.name || '');
      setPackageCredits(String(next.package?.credits || ''));
      setPackageUsd(String(next.package?.price_usd || 0));
      setPackageXaf(String(next.package?.price_xaf || 0));
    }
  };

  const submitMutation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mutation) return;
    setBusy(true);
    try {
      let payload: Record<string, unknown>;
      if (mutation.kind === 'credits') {
        payload = { action: 'adjust-credits', userId: mutation.client.id, change: Number(amount), reason };
      } else if (mutation.kind === 'create-license') {
        payload = { action: 'create-license', userId: mutation.client.id, creditsPerSecond: Number(rate), reason };
      } else if (mutation.kind === 'license') {
        payload = {
          action: 'manage-license',
          licenseId: mutation.license.id,
          licenseAction: mutation.action,
          creditsPerSecond: mutation.action === 'set_rate' ? Number(rate) : undefined,
          reason,
        };
      } else if (mutation.kind === 'payment') {
        payload = {
          action: 'decide-payment',
          paymentId: mutation.payment.id,
          source: mutation.payment.source,
          status: mutation.status,
          reason,
        };
      } else {
        payload = {
          action: 'upsert-package',
          packageId: mutation.package?.id,
          name: packageName,
          credits: Number(packageCredits),
          priceUsd: Number(packageUsd),
          priceXaf: Number(packageXaf),
          reason,
        };
      }
      const result = await adminRequest<{ code?: string }>('/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (result.code) setRevealedCode(result.code);
      toast.success('Administrative change saved and audited.');
      setMutation(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Administrative change failed.');
    } finally {
      setBusy(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleClients = clients.filter((client) =>
    !normalizedQuery || `${client.name || ''} ${client.email}`.toLowerCase().includes(normalizedQuery));
  const visiblePayments = payments.filter((payment) =>
    (paymentFilter === 'all' || payment.status === paymentFilter)
    && (!normalizedQuery || `${payment.user?.name || ''} ${payment.user?.email || ''} ${payment.reference || ''}`.toLowerCase().includes(normalizedQuery)));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Secure operations</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">Clients, licenses, billing, payments, and immutable audit history.</p>
        </div>
        <Button variant="secondary" onClick={() => void loadData()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric title="Clients" value={overview.totalUsers} icon={<Users className="size-4" />} />
        <Metric title="Wallet credits" value={overview.totalCredits} icon={<CreditCard className="size-4" />} />
        <Metric title="Active PRO" value={overview.activeProLicenses} icon={<ShieldCheck className="size-4" />} />
        <Metric title="Pending licenses" value={overview.pendingProLicenses} icon={<KeyRound className="size-4" />} />
        <Metric title="Pending payments" value={overview.pendingPayments} icon={<Activity className="size-4" />} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-6 h-auto flex-wrap border border-border/70 bg-muted/45 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="licenses">Licenses</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Revenue by currency</CardTitle><CardDescription>Currencies are never combined.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(overview.revenueByCurrency).length ? Object.entries(overview.revenueByCurrency).map(([currency, value]) => (
                <div key={currency} className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3">
                  <span className="font-mono text-xs text-muted-foreground">{currency}</span>
                  <strong>{Number(value).toLocaleString()} {currency}</strong>
                </div>
              )) : <Empty label="No confirmed revenue." />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Usage by provider</CardTitle><CardDescription>Last 30 days, including fal.ai cost.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(overview.usageByProvider).length ? Object.entries(overview.usageByProvider).map(([provider, value]) => (
                <div key={provider} className="rounded-lg border border-border/60 px-4 py-3">
                  <div className="mb-2 flex justify-between"><strong className="uppercase">{provider}</strong><span>{value.sessions} sessions</span></div>
                  <p className="text-xs text-muted-foreground">{formatDuration(value.seconds)} · {value.credits.toLocaleString()} cr · ${value.providerCostUsd.toFixed(2)} provider cost</p>
                </div>
              )) : <Empty label="No session usage." />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clients">
          <DataCard title="Client directory" description="Search accounts and perform audited wallet or license actions." action={<SearchBox value={query} onChange={setQuery} />}>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Credits</TableHead><TableHead>PRO</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {visibleClients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell><strong>{client.name || 'Unnamed'}</strong><p className="text-xs text-muted-foreground">{client.email}</p></TableCell>
                    <TableCell>{client.credits.toLocaleString()} cr</TableCell>
                    <TableCell>{client.proLicense ? <Badge className={licenseTone(client.proLicense.status)}>{client.proLicense.status} · {client.proLicense.credits_per_second} cr/s</Badge> : <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => openMutation({ kind: 'credits', client })}>Adjust credits</Button>{!client.proLicense && <Button size="sm" variant="accent" onClick={() => openMutation({ kind: 'create-license', client })}><Plus className="size-3" /> License</Button>}</div></TableCell>
                  </TableRow>
                ))}
                {!visibleClients.length && <EmptyRow columns={4} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="licenses">
          <DataCard title="PRO licenses" description="Account-bound access, server-authoritative rates, and revocation controls.">
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>Rate</TableHead><TableHead>Code</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {licenses.map((license) => (
                  <TableRow key={license.id}>
                    <TableCell>{license.user?.name || 'Unnamed'}<p className="text-xs text-muted-foreground">{license.user?.email}</p></TableCell>
                    <TableCell><Badge className={licenseTone(license.status)}>{license.status}</Badge></TableCell>
                    <TableCell>{license.credits_per_second} cr/s</TableCell>
                    <TableCell className="font-mono">•••• {license.code_last4}</TableCell>
                    <TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => openMutation({ kind: 'license', license, action: 'set_rate' })}>Rate</Button>{license.status === 'revoked' ? <Button size="sm" variant="accent" onClick={() => openMutation({ kind: 'license', license, action: 'reactivate' })}>Reactivate</Button> : <Button size="sm" variant="destructive" onClick={() => openMutation({ kind: 'license', license, action: 'revoke' })}>Revoke</Button>}</div></TableCell>
                  </TableRow>
                ))}
                {!licenses.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="payments">
          <DataCard title="Payment review" description="Confirmation credits the wallet exactly once and requires an audit reason." action={<div className="flex gap-2"><SearchBox value={query} onChange={setQuery} /><select className="rounded-md border border-border bg-background px-3 text-sm" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="pending">Pending</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="all">All</option></select></div>}>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Amount</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Decision</TableHead></TableRow></TableHeader>
              <TableBody>
                {visiblePayments.map((payment) => (
                  <TableRow key={`${payment.source}-${payment.id}`}>
                    <TableCell>{payment.user?.name || 'Unknown'}<p className="text-xs text-muted-foreground">{payment.user?.email}</p></TableCell>
                    <TableCell>{Number(payment.amount).toLocaleString()} {payment.currency || 'UNKNOWN'}<p className="text-xs text-muted-foreground">{payment.credits || 0} cr</p></TableCell>
                    <TableCell>{payment.source}<p className="font-mono text-xs text-muted-foreground">{payment.provider_status || payment.reference || 'n/a'}</p></TableCell>
                    <TableCell><Badge variant="outline">{payment.status}</Badge></TableCell>
                    <TableCell className="text-right">{payment.status === 'pending' && <div className="flex justify-end gap-2"><Button size="sm" variant="accent" disabled={payment.source === 'crypto' && payment.provider_status !== 'SUCCESSFUL'} onClick={() => openMutation({ kind: 'payment', payment, status: 'completed' })}><Check className="size-3" /> Confirm</Button><Button size="sm" variant="destructive" onClick={() => openMutation({ kind: 'payment', payment, status: 'failed' })}><X className="size-3" /> Decline</Button></div>}</TableCell>
                  </TableRow>
                ))}
                {!visiblePayments.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="usage">
          <DataCard title="Session usage" description="Provider usage and fal.ai cost at $0.04 per usable second." action={<select className="rounded-md border border-border bg-background px-3 py-2 text-sm" value={period} onChange={(event) => { const next = event.target.value; setPeriod(next); void loadData(next); }}><option value="today">Today</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="all">All</option></select>}>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Provider</TableHead><TableHead>Duration</TableHead><TableHead>Credits</TableHead><TableHead>Provider cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {usage.map((row) => <TableRow key={row.id}><TableCell>{row.user?.email || 'Unknown'}</TableCell><TableCell className="uppercase">{row.provider}</TableCell><TableCell>{formatDuration(row.seconds_used)}</TableCell><TableCell>{Number(row.credits_used || 0).toLocaleString()} at {row.credits_per_second} cr/s</TableCell><TableCell>{row.providerCostUsd == null ? 'n/a' : `$${row.providerCostUsd.toFixed(2)}`}</TableCell></TableRow>)}
                {!usage.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="packages">
          <DataCard title="Credit packages" description="Package changes pass through the authenticated admin API." action={<Button variant="accent" size="sm" onClick={() => openMutation({ kind: 'package' })}><Plus className="size-3" /> Add package</Button>}>
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Credits</TableHead><TableHead>USD</TableHead><TableHead>XAF</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {packages.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.credits.toLocaleString()}</TableCell><TableCell>${item.price_usd}</TableCell><TableCell>{item.price_xaf.toLocaleString()} XAF</TableCell><TableCell className="text-right"><Button size="sm" variant="secondary" onClick={() => openMutation({ kind: 'package', package: item })}>Edit</Button></TableCell></TableRow>)}
                {!packages.length && <EmptyRow columns={5} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="audit">
          <DataCard title="Immutable audit log" description="Sensitive admin actions cannot be edited or deleted.">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Reason</TableHead><TableHead>Target</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.map((row) => <TableRow key={row.id}><TableCell>{new Date(row.created_at).toLocaleString()}</TableCell><TableCell className="font-mono text-xs">{row.action}</TableCell><TableCell>{row.reason}</TableCell><TableCell className="font-mono text-xs">{row.target_user_id || 'system'}</TableCell></TableRow>)}
                {!audit.length && <EmptyRow columns={4} />}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>
      </Tabs>

      <Dialog open={mutation !== null} onOpenChange={(open) => !open && setMutation(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{mutationTitle(mutation)}</DialogTitle><DialogDescription>Every change requires a clear operational reason and is associated with your administrator account.</DialogDescription></DialogHeader>
          <form onSubmit={submitMutation} className="space-y-4">
            {mutation?.kind === 'credits' && <Field label="Credit change"><Input type="number" step="1" placeholder="Use a negative value to deduct" value={amount} onChange={(event) => setAmount(event.target.value)} required /></Field>}
            {(mutation?.kind === 'create-license' || (mutation?.kind === 'license' && mutation.action === 'set_rate')) && <Field label="Credits per second"><Input type="number" min="1" step="1" value={rate} onChange={(event) => setRate(event.target.value)} required /><p className="text-xs text-muted-foreground">Default future rate: 80. Negotiated first-client rate: 46.</p></Field>}
            {mutation?.kind === 'package' && <><Field label="Package name"><Input value={packageName} onChange={(event) => setPackageName(event.target.value)} required /></Field><Field label="Credits"><Input type="number" min="1" step="1" value={packageCredits} onChange={(event) => setPackageCredits(event.target.value)} required /></Field><div className="grid grid-cols-2 gap-3"><Field label="Price USD"><Input type="number" min="0" step="0.01" value={packageUsd} onChange={(event) => setPackageUsd(event.target.value)} required /></Field><Field label="Price XAF"><Input type="number" min="0" step="1" value={packageXaf} onChange={(event) => setPackageXaf(event.target.value)} required /></Field></div></>}
            <Field label="Audit reason"><Input value={reason} minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Why is this change required?" required /></Field>
            <DialogFooter><Button type="button" variant="minimal" onClick={() => setMutation(null)}>Cancel</Button><Button type="submit" variant={mutation?.kind === 'payment' && mutation.status === 'failed' || mutation?.kind === 'license' && mutation.action === 'revoke' ? 'destructive' : 'accent'} disabled={busy}>{busy ? 'Saving...' : 'Confirm change'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revealedCode !== null} onOpenChange={(open) => !open && setRevealedCode(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>PRO license generated</DialogTitle><DialogDescription>This full code is shown once. Regeneration replaces it.</DialogDescription></DialogHeader>
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-center font-mono text-sm text-blue-200">{revealedCode}</div>
          <DialogFooter><Button variant="accent" onClick={() => { if (revealedCode) void navigator.clipboard.writeText(revealedCode); toast.success('License code copied.'); }}><Clipboard className="size-4" /> Copy once</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle><span className="text-blue-400">{icon}</span></CardHeader><CardContent><p className="text-2xl font-semibold"><AnimatedNumber value={Number(value || 0)} /></p></CardContent></Card>;
}

function DataCard({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <Card><CardHeader className="flex flex-row items-start justify-between gap-4"><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>{action}</CardHeader><CardContent><div className="overflow-x-auto rounded-lg border border-border/70">{children}</div></CardContent></Card>;
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="w-52 pl-9" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search" /></div>;
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

function EmptyRow({ columns }: { columns: number }) {
  return <TableRow><TableCell colSpan={columns}><Empty label="No records found." /></TableCell></TableRow>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="text-sm font-medium text-foreground">{label}</span>{children}</label>;
}

function mutationTitle(mutation: Mutation | null) {
  if (!mutation) return 'Administrative change';
  if (mutation.kind === 'credits') return `Adjust credits for ${mutation.client.email}`;
  if (mutation.kind === 'create-license') return `Generate PRO license for ${mutation.client.email}`;
  if (mutation.kind === 'license') return `${mutation.action.replace('_', ' ')} PRO license`;
  if (mutation.kind === 'payment') return `${mutation.status === 'completed' ? 'Confirm' : 'Decline'} payment`;
  return mutation.package ? 'Edit credit package' : 'Create credit package';
}
