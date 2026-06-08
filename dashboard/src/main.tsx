import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRightLeft,
  BellRing,
  CheckCircle2,
  CircleOff,
  Coins,
  Copy,
  Gauge,
  KeyRound,
  LogOut,
  Plus,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Wallet
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

type NetworkKind = "evm" | "tron";
type TokenSymbol = "USDT" | "USDC";
type WalletPurpose = "gas" | "treasury";
type Status =
  | "active"
  | "expired"
  | "completed"
  | "closed"
  | "detected"
  | "confirmed"
  | "late"
  | "submitted"
  | "failed"
  | "pending"
  | "unmatched"
  | "ambiguous"
  | "matched"
  | "sent"
  | "settled"
  | "gas_top_up"
  | "sweep";
type HistoryResource = "depositAddresses" | "deposits" | "treasuryTransfers" | "walletTransactions" | "gasTopUps" | "sweeps" | "webhooks";
type WebhookEventType =
  | "wallet.created"
  | "wallet.expired"
  | "direct_deposit.created"
  | "direct_deposit.expired"
  | "transfer.detected"
  | "deposit.confirmed"
  | "deposit.late_detected"
  | "gas.topup.submitted"
  | "gas.topup.confirmed"
  | "gas.topup.failed"
  | "sweep.submitted"
  | "sweep.confirmed"
  | "sweep.failed";

interface Merchant {
  id: string;
  status: string;
  name: string;
  rejectDuplicateClientPendingDeposits: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiKey {
  id: string;
  merchantId: string;
  publicKey: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface WebhookConfig {
  merchantId: string;
  url: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ConfigureWebhookResponse {
  merchantId: string;
  url: string;
  active: boolean;
  webhookSecret: string | null;
  updatedAt: string;
}

interface NotificationPreferences {
  merchantId: string;
  enabledEvents: WebhookEventType[];
  createdAt: string | null;
  updatedAt: string | null;
}

interface EnabledNetwork {
  network: string;
  kind: NetworkKind;
  chainId: number | null;
  confirmations: number;
  tokens: Array<{ symbol: TokenSymbol; contractAddress: string; decimals: number }>;
}

interface TreasuryWallet {
  id: string;
  merchantId: string;
  network: string;
  token: TokenSymbol;
  address: string;
  label: string;
  isDefault: boolean;
  operationalWalletId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OperationalWallet {
  id: string;
  merchantId: string | null;
  purpose: WalletPurpose;
  network: string;
  token: TokenSymbol | null;
  address: string;
  label: string;
  status: string;
  hasStoredPrivateKey: boolean;
  updatedAt: string;
}

interface DepositAddress {
  id: string;
  merchantId: string;
  network: string;
  token: TokenSymbol;
  address: string;
  treasuryWalletId: string | null;
  status: "active" | "expired" | "completed" | "closed";
  flow: "temporary_wallet" | "direct_treasury";
  clientId: string;
  requestedAmountFormatted: string | null;
  receivedAmountFormatted: string | null;
  matchStatus: "pending" | "matched" | null;
  matchedTransferId: string | null;
  matchSource: "auto" | "manual" | null;
  externalId: string | null;
  expiresAt: string;
  createdAt: string;
}

interface Deposit {
  id: string;
  merchantId: string;
  depositAddressId: string;
  network: string;
  token: TokenSymbol;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountFormatted: string;
  confirmations: number;
  status: "detected" | "confirmed" | "late";
  settlementStatus: "pending" | "submitted" | "settled";
  settlementStep: "gas_top_up" | "sweep" | null;
  settlementFailureReason: string | null;
  settlementUpdatedAt: string;
  detectedAt: string;
  confirmedAt: string | null;
}

interface GasTopUp {
  id: string;
  merchantId: string;
  network: string;
  txHash: string | null;
  amountWei: string;
  attemptNumber: number;
  status: "submitted" | "confirmed" | "failed";
  failureReason: string | null;
  createdAt: string;
}

interface Sweep {
  id: string;
  merchantId: string;
  network: string;
  token: TokenSymbol;
  txHash: string | null;
  amountFormatted: string;
  toAddress: string;
  attemptNumber: number;
  status: "submitted" | "confirmed" | "failed";
  failureReason: string | null;
  createdAt: string;
}

interface WalletTransaction {
  id: string;
  merchantId: string | null;
  sourceWalletId: string;
  network: string;
  token: TokenSymbol | null;
  asset: TokenSymbol | "NATIVE";
  txHash: string | null;
  fromAddress: string;
  toAddress: string;
  amountFormatted: string;
  status: "submitted" | "confirmed" | "failed";
  failureReason: string | null;
  createdAt: string;
}

interface TreasuryTransfer {
  id: string;
  merchantId: string;
  treasuryWalletId: string;
  network: string;
  token: TokenSymbol;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountFormatted: string;
  status: "unmatched" | "ambiguous" | "matched";
  candidateDepositAddressIds: string[];
  matchedDepositAddressId: string | null;
  matchSource: "auto" | "manual" | null;
  detectedAt: string;
}

interface WebhookEvent {
  id: string;
  merchantId: string;
  type: string;
  url: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  responseStatus: number | null;
  createdAt: string;
}

interface DashboardData {
  merchants: Merchant[];
  apiKeys: ApiKey[];
  webhookConfig: WebhookConfig | null;
  notificationPreferences: NotificationPreferences;
  networks: EnabledNetwork[];
  treasuryWallets: TreasuryWallet[];
  operationalWallets: OperationalWallet[];
  depositAddresses: DepositAddress[];
  deposits: Deposit[];
  treasuryTransfers: TreasuryTransfer[];
  gasTopUps: GasTopUp[];
  sweeps: Sweep[];
  walletTransactions: WalletTransaction[];
  webhooks: WebhookEvent[];
}

interface Overview {
  stats: Record<string, number>;
  charts: {
    depositTrend: Array<{ date: string; count: number; confirmedCount: number; amount: number }>;
    depositStatus: Array<{ name: string; value: number }>;
    tokenVolume: Array<{ asset: string; amount: number; count: number }>;
    walletTransactionStatus: Array<{ name: string; value: number }>;
    webhookStatus: Array<{ name: string; value: number }>;
  };
  recentDeposits: Deposit[];
  recentWalletTransactions: WalletTransaction[];
  recentWebhooks: WebhookEvent[];
}

interface HistoryResponse<T extends Record<string, unknown>> {
  resource: HistoryResource;
  limit: number;
  offset: number;
  total: number;
  nextOffset: number | null;
  previousOffset: number | null;
  items: T[];
}

type Tab = "overview" | "settings" | "wallets" | "deposits" | "transfers" | "webhooks";

const tokenStorageKey = "crypto-dashboard-token";
const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "settings", label: "Settings", icon: KeyRound },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "deposits", label: "Deposits", icon: Coins },
  { id: "transfers", label: "Transfers", icon: ArrowRightLeft },
  { id: "webhooks", label: "Callbacks", icon: BellRing }
];
const chartColors = ["#0891b2", "#16a34a", "#f59e0b", "#e11d48", "#7c3aed", "#475569"];
const notificationEvents: Array<{ type: WebhookEventType; label: string; group: "wallet" | "deposit" | "gas" | "sweep" }> = [
  { type: "wallet.created", label: "Wallet created", group: "wallet" },
  { type: "wallet.expired", label: "Wallet expired", group: "wallet" },
  { type: "direct_deposit.created", label: "Direct deposit created", group: "deposit" },
  { type: "direct_deposit.expired", label: "Direct deposit expired", group: "deposit" },
  { type: "transfer.detected", label: "Transfer detected", group: "deposit" },
  { type: "deposit.confirmed", label: "Deposit confirmed", group: "deposit" },
  { type: "deposit.late_detected", label: "Late deposit detected", group: "deposit" },
  { type: "gas.topup.submitted", label: "Gas top-up submitted", group: "gas" },
  { type: "gas.topup.confirmed", label: "Gas top-up confirmed", group: "gas" },
  { type: "gas.topup.failed", label: "Gas top-up failed", group: "gas" },
  { type: "sweep.submitted", label: "Sweep submitted", group: "sweep" },
  { type: "sweep.confirmed", label: "Sweep confirmed", group: "sweep" },
  { type: "sweep.failed", label: "Sweep failed", group: "sweep" }
];

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenStorageKey) ?? "");
  const [data, setData] = useState<DashboardData | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh(currentToken = token) {
    if (!currentToken) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [overviewResponse, dataResponse] = await Promise.all([
        apiGet<Overview>("/dashboard/api/overview", currentToken),
        apiGet<DashboardData>("/dashboard/api/data?limit=1000", currentToken)
      ]);
      setOverview(overviewResponse);
      setData(dataResponse);
    } catch (refreshError) {
      setError(errorMessage(refreshError));
      if (isUnauthorized(refreshError)) {
        sessionStorage.removeItem(tokenStorageKey);
        setToken("");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function onLogin(nextToken: string) {
    sessionStorage.setItem(tokenStorageKey, nextToken);
    setToken(nextToken);
    void refresh(nextToken);
  }

  function logout() {
    sessionStorage.removeItem(tokenStorageKey);
    setToken("");
    setData(null);
    setOverview(null);
  }

  async function mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined> {
    setError("");
    setNotice("");
    try {
      const result = await request;
      setNotice(successMessage);
      await refresh();
      return result;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return undefined;
    }
  }

  if (!token) {
    return <LoginScreen onLogin={onLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={22} /></div>
          <div>
            <strong>Stablecoin Gateway</strong>
            <span>Owner console</span>
          </div>
        </div>
        <nav className="nav-tabs">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="secondary full-width" onClick={logout}>
          <LogOut size={16} />
          Sign out
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
            <p>{data ? `${data.networks.length} networks enabled` : "Loading dashboard data"}</p>
          </div>
          <div className="topbar-actions">
            {data && overview ? (
              <div className="quick-stats">
                <span><RadioTower size={15} />{data.networks.length} networks</span>
                <span><BellRing size={15} />{overview.stats.pendingWebhooks ?? 0} pending</span>
              </div>
            ) : null}
            <button className="secondary icon-button" onClick={() => void refresh()} disabled={loading} title="Refresh">
              <RefreshCw size={16} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {notice ? <div className="notice success"><CheckCircle2 size={16} />{notice}</div> : null}
        {error ? <div className="notice error">{error}</div> : null}

        {!data || !overview ? (
          <div className="empty-state">Loading</div>
        ) : (
          <DashboardView
            tab={tab}
            data={data}
            overview={overview}
            token={token}
            mutate={mutate}
          />
        )}
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin(token: string): void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await apiPost<{ token: string }>("/dashboard/api/login", undefined, { username, password });
      onLogin(result.token);
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand large">
          <div className="brand-mark"><ShieldCheck size={24} /></div>
          <div>
            <strong>Stablecoin Gateway</strong>
            <span>Owner console</span>
          </div>
        </div>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <div className="notice error">{error}</div> : null}
        <button className="primary full-width" disabled={loading}>
          <KeyRound size={16} />
          Sign in
        </button>
      </form>
    </div>
  );
}

function DashboardView({
  tab,
  data,
  overview,
  token,
  mutate
}: {
  tab: Tab;
  data: DashboardData;
  overview: Overview;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  switch (tab) {
    case "overview":
      return <OverviewPanel overview={overview} data={data} />;
    case "settings":
      return <SettingsPanel data={data} token={token} mutate={mutate} />;
    case "wallets":
      return <WalletsPanel data={data} token={token} mutate={mutate} />;
    case "deposits":
      return <DepositsPanel data={data} token={token} mutate={mutate} />;
    case "transfers":
      return <TransfersPanel data={data} token={token} mutate={mutate} />;
    case "webhooks":
      return <WebhooksPanel data={data} />;
  }
}

function OverviewPanel({ overview, data }: { overview: Overview; data: DashboardData }) {
  const statItems = [
    { label: "Networks", value: data.networks.length, icon: RadioTower, tone: "cyan" },
    { label: "Active wallets", value: overview.stats.activeDepositAddresses ?? 0, icon: Wallet, tone: "green" },
    { label: "Confirmed deposits", value: overview.stats.confirmedDeposits ?? 0, icon: Coins, tone: "amber" },
    { label: "Pending callbacks", value: overview.stats.pendingWebhooks ?? 0, icon: BellRing, tone: "rose" },
    { label: "Operational wallets", value: overview.stats.operationalWallets ?? 0, icon: ShieldCheck, tone: "violet" },
    { label: "Submitted transfers", value: overview.stats.submittedWalletTransactions ?? 0, icon: Activity, tone: "slate" }
  ];

  return (
    <section className="stack">
      <div className="metric-grid">
        {statItems.map((item) => {
          const Icon = item.icon;
          return (
            <div className={`metric ${item.tone}`} key={item.label}>
              <div className="metric-icon"><Icon size={18} /></div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          );
        })}
      </div>
      <div className="chart-grid">
        <Panel title="Deposit activity">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={overview.charts.depositTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ec" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="count" name="Detected" stroke="#0891b2" fill="#a5f3fc" />
                <Area type="monotone" dataKey="confirmedCount" name="Confirmed" stroke="#16a34a" fill="#bbf7d0" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Confirmed token volume">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={overview.charts.tokenVolume}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ec" />
                <XAxis dataKey="asset" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="amount" name="Amount" fill="#0891b2" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="chart-grid three">
        <PiePanel title="Deposit status" data={overview.charts.depositStatus} />
        <PiePanel title="Wallet transaction status" data={overview.charts.walletTransactionStatus} />
        <PiePanel title="Callback status" data={overview.charts.webhookStatus} />
      </div>
      <div className="split-grid dashboard-tables">
        <Panel title="Recent deposits">
          <DepositsTable deposits={overview.recentDeposits} compact />
        </Panel>
        <Panel title="Wallet transactions">
          <WalletTransactionsTable transactions={overview.recentWalletTransactions} wallets={data.operationalWallets} merchants={data.merchants} compact />
        </Panel>
      </div>
    </section>
  );
}

function PiePanel({ title, data }: { title: string; data: Array<{ name: string; value: number }> }) {
  return (
    <Panel title={title}>
      <div className="chart-box small">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function SettingsPanel({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [apiKeyResult, setApiKeyResult] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const ownerMerchant = data.merchants[0];
  const merchantSettingsKey = ownerMerchant
    ? `${ownerMerchant.rejectDuplicateClientPendingDeposits}|${ownerMerchant.updatedAt}`
    : "none";
  const [rejectDuplicateClientPendingDeposits, setRejectDuplicateClientPendingDeposits] = useState(
    ownerMerchant?.rejectDuplicateClientPendingDeposits ?? true
  );
  const webhookConfigKey = data.webhookConfig
    ? `${data.webhookConfig.url}|${data.webhookConfig.active}|${data.webhookConfig.updatedAt}`
    : "none";
  const [webhookUrl, setWebhookUrl] = useState(data.webhookConfig?.url ?? "");
  const [webhookActive, setWebhookActive] = useState(data.webhookConfig?.active ?? true);
  const [webhookSecretResult, setWebhookSecretResult] = useState<string | null>(null);
  const notificationPreferenceKey = data.notificationPreferences.enabledEvents.join("|");
  const [enabledEvents, setEnabledEvents] = useState<WebhookEventType[]>(data.notificationPreferences.enabledEvents);

  useEffect(() => {
    setRejectDuplicateClientPendingDeposits(ownerMerchant?.rejectDuplicateClientPendingDeposits ?? true);
  }, [merchantSettingsKey, ownerMerchant]);

  useEffect(() => {
    setWebhookUrl(data.webhookConfig?.url ?? "");
    setWebhookActive(data.webhookConfig?.active ?? true);
  }, [webhookConfigKey, data.webhookConfig]);

  useEffect(() => {
    setEnabledEvents(data.notificationPreferences.enabledEvents);
  }, [data.notificationPreferences.updatedAt, notificationPreferenceKey]);

  async function createApiKey(event: FormEvent) {
    event.preventDefault();
    const result = await mutate<{ apiKey: string; apiSecret: string }>(
      apiPost("/dashboard/api/api-keys", token, {}),
      "API key created"
    );
    if (result) {
      setApiKeyResult(result);
    }
  }

  async function saveWebhook(event: FormEvent) {
    event.preventDefault();
    const result = await mutate<ConfigureWebhookResponse>(
      apiPut("/dashboard/api/webhook", token, {
        url: webhookUrl,
        active: webhookActive
      }),
      "Callback endpoint saved"
    );
    setWebhookSecretResult(result?.webhookSecret ?? null);
  }

  async function saveMerchantSettings(event: FormEvent) {
    event.preventDefault();
    await mutate(
      apiPut("/dashboard/api/merchant-settings", token, {
        rejectDuplicateClientPendingDeposits
      }),
      "Deposit request rules saved"
    );
  }

  async function rotateWebhookSecret() {
    const result = await mutate<ConfigureWebhookResponse>(
      apiPut("/dashboard/api/webhook", token, {
        url: webhookUrl,
        active: webhookActive,
        rotateSecret: true
      }),
      "Callback secret rotated"
    );
    setWebhookSecretResult(result?.webhookSecret ?? null);
  }

  async function saveNotificationPreferences(event: FormEvent) {
    event.preventDefault();
    await mutate(
      apiPut("/dashboard/api/notification-preferences", token, {
        enabledEvents
      }),
      "Notification preferences saved"
    );
  }

  function toggleNotificationEvent(type: WebhookEventType) {
    setEnabledEvents((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    );
  }

  return (
    <section className="stack">
      <div className="split-grid">
        <Panel title="Owner account">
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>ID</th></tr></thead>
            <tbody>
              {data.merchants.map((merchant) => (
                <tr key={merchant.id}>
                  <td>{merchant.name}</td>
                  <td><StatusPill status={merchant.status as Status} /></td>
                  <td><CopyText value={merchant.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="API access">
          <form className="form-grid" onSubmit={createApiKey}>
            <button className="primary"><KeyRound size={16} />Create key</button>
          </form>
          {apiKeyResult ? (
            <div className="secret-box">
              <div><span>API key</span><CopyText value={apiKeyResult.apiKey} /></div>
              <div><span>API secret</span><CopyText value={apiKeyResult.apiSecret} /></div>
            </div>
          ) : null}
        </Panel>
      </div>
      <div className="split-grid">
        <Panel title="API keys">
          <ApiKeysTable apiKeys={data.apiKeys} />
        </Panel>
        <Panel title="Callback endpoint">
          <form className="form-grid" onSubmit={saveWebhook}>
            <label>
              URL
              <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} required />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={webhookActive} onChange={(event) => setWebhookActive(event.target.checked)} />
              Active
            </label>
            <button className="primary"><RadioTower size={16} />Save</button>
            <button className="secondary" type="button" onClick={() => void rotateWebhookSecret()} disabled={!webhookUrl}>
              <RefreshCw size={16} />Rotate secret
            </button>
          </form>
          {webhookSecretResult ? (
            <div className="secret-box">
              <div><span>Callback secret</span><CopyText value={webhookSecretResult} /></div>
            </div>
          ) : null}
        </Panel>
      </div>
      <Panel title="Deposit request rules">
        <form className="form-grid" onSubmit={saveMerchantSettings}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rejectDuplicateClientPendingDeposits}
              onChange={(event) => setRejectDuplicateClientPendingDeposits(event.target.checked)}
            />
            Reject duplicate active client deposits
          </label>
          <button className="primary"><ShieldCheck size={16} />Save</button>
        </form>
      </Panel>
      <Panel title="Notification events">
        <form className="preference-form" onSubmit={saveNotificationPreferences}>
          <div className="preference-toolbar">
            <div className="preference-count">
              <SlidersHorizontal size={16} />
              <strong>{enabledEvents.length}</strong>
              <span>enabled</span>
            </div>
            <div className="preference-actions">
              <button className="secondary" type="button" onClick={() => setEnabledEvents(notificationEvents.map((item) => item.type))}>
                <CheckCircle2 size={16} />All
              </button>
              <button className="secondary" type="button" onClick={() => setEnabledEvents([])}>
                <CircleOff size={16} />None
              </button>
              <button className="primary"><ShieldCheck size={16} />Save</button>
            </div>
          </div>
          <div className="event-grid">
            {notificationEvents.map((item) => {
              const checked = enabledEvents.includes(item.type);
              return (
                <label className={`event-option ${checked ? "selected" : ""}`} key={item.type}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleNotificationEvent(item.type)}
                  />
                  <span className="event-copy">
                    <strong>{item.label}</strong>
                    <small>{item.type}</small>
                  </span>
                  <span className={`event-group ${item.group}`}>{item.group}</span>
                </label>
              );
            })}
          </div>
        </form>
      </Panel>
    </section>
  );
}

function WalletsPanel({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  return (
    <section className="stack">
      <div className="split-grid">
        <GenerateGasWalletForm data={data} token={token} mutate={mutate} />
        <GenerateTreasuryWalletForm data={data} token={token} mutate={mutate} />
      </div>
      <Panel title="Register treasury address">
        <RegisterTreasuryWalletForm data={data} token={token} mutate={mutate} />
      </Panel>
      <Panel title="Operational wallets">
        <OperationalWalletsTable wallets={data.operationalWallets} />
      </Panel>
      <Panel title="Treasury wallets">
        <TreasuryWalletsTable wallets={data.treasuryWallets} token={token} mutate={mutate} />
      </Panel>
    </section>
  );
}

function GenerateGasWalletForm({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [network, setNetwork] = useState(data.networks[0]?.network ?? "");
  const [label, setLabel] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate(apiPost("/dashboard/api/wallets/gas", token, { network, label: label || undefined }), "Gas wallet generated");
    setLabel("");
  }

  return (
    <Panel title="Generate gas wallet">
      <form className="form-grid" onSubmit={submit}>
        <Select label="Network" value={network} onChange={setNetwork} options={data.networks.map((item) => item.network)} />
        <label>
          Label
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button className="primary"><Plus size={16} />Generate</button>
      </form>
    </Panel>
  );
}

function GenerateTreasuryWalletForm({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [network, setNetwork] = useState(data.networks[0]?.network ?? "");
  const [tokenSymbol, setTokenSymbol] = useState<TokenSymbol>("USDT");
  const [label, setLabel] = useState("");
  const tokens = tokensForNetwork(data.networks, network);

  useEffect(() => {
    if (tokens.length > 0 && !tokens.includes(tokenSymbol)) {
      setTokenSymbol(tokens[0]);
    }
  }, [network, tokens, tokenSymbol]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate(
      apiPost("/dashboard/api/wallets/treasury", token, { network, token: tokenSymbol, label: label || undefined }),
      "Treasury wallet generated"
    );
    setLabel("");
  }

  return (
    <Panel title="Generate treasury wallet">
      <form className="form-grid" onSubmit={submit}>
        <Select label="Network" value={network} onChange={setNetwork} options={data.networks.map((item) => item.network)} />
        <Select label="Token" value={tokenSymbol} onChange={(value) => setTokenSymbol(value as TokenSymbol)} options={tokens} />
        <label>
          Label
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button className="primary"><Plus size={16} />Generate</button>
      </form>
    </Panel>
  );
}

function RegisterTreasuryWalletForm({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [network, setNetwork] = useState(data.networks[0]?.network ?? "");
  const [tokenSymbol, setTokenSymbol] = useState<TokenSymbol>("USDT");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const tokens = tokensForNetwork(data.networks, network);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate(
      apiPost("/dashboard/api/treasury-wallets", token, { network, token: tokenSymbol, address, label: label || undefined }),
      "Treasury wallet registered"
    );
    setAddress("");
    setLabel("");
  }

  return (
    <form className="inline-form wide" onSubmit={submit}>
      <Select label="Network" value={network} onChange={setNetwork} options={data.networks.map((item) => item.network)} />
      <Select label="Token" value={tokenSymbol} onChange={(value) => setTokenSymbol(value as TokenSymbol)} options={tokens} />
      <label className="grow">
        Address
        <input value={address} onChange={(event) => setAddress(event.target.value)} required />
      </label>
      <label>
        Label
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <button className="primary"><Plus size={16} />Register</button>
    </form>
  );
}

function DepositsPanel({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  async function retrySettlement(transferId: string) {
    const result = await mutate(
      apiPost(`/dashboard/api/deposits/${transferId}/retry-settlement`, token, {}),
      "Settlement retry submitted"
    );
    if (result) {
      setHistoryRefreshKey((current) => current + 1);
    }
  }

  async function matchTreasuryTransfer(treasuryTransferId: string, depositAddressId: string) {
    const result = await mutate(
      apiPost(`/dashboard/api/treasury-transfers/${treasuryTransferId}/match`, token, { depositAddressId }),
      "Treasury transfer matched"
    );
    if (result) {
      setHistoryRefreshKey((current) => current + 1);
    }
  }

  async function closeDepositAddress(depositAddressId: string) {
    const result = await mutate(
      apiPost(`/dashboard/api/deposit-addresses/${depositAddressId}/close`, token, {}),
      "Deposit request closed"
    );
    if (result) {
      setHistoryRefreshKey((current) => current + 1);
    }
  }

  return (
    <section className="stack">
      <HistoryPanel
        title="Deposit address history"
        resource="depositAddresses"
        networks={data.networks}
        statusOptions={["active", "expired", "completed", "closed"]}
        refreshKey={historyRefreshKey}
        columns={[
          { header: "Asset", render: (row) => `${stringField(row, "network")} ${stringField(row, "token")}` },
          { header: "Client", render: (row) => <CopyText value={stringField(row, "clientId")} /> },
          { header: "Flow", render: (row) => <StatusPill status={stringField(row, "flow")} /> },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Requested", render: (row) => stringField(row, "requestedAmountFormatted") || "-" },
          { header: "Received", render: (row) => stringField(row, "receivedAmountFormatted") || "-" },
          { header: "Match", render: (row) => stringField(row, "matchStatus") ? <StatusPill status={stringField(row, "matchStatus")} /> : "-" },
          { header: "Address", render: (row) => <CopyText value={stringField(row, "address")} /> },
          { header: "Treasury", render: (row) => stringField(row, "treasuryWalletId") ? <CopyText value={stringField(row, "treasuryWalletId")} /> : "-" },
          { header: "Expires", render: (row) => formatDate(stringField(row, "expiresAt")) },
          {
            header: "Action",
            render: (row) => stringField(row, "status") === "active"
              ? (
                <button className="secondary compact-button" type="button" onClick={() => void closeDepositAddress(stringField(row, "id"))}>
                  <CircleOff size={15} />Close
                </button>
              )
              : "-"
          }
        ]}
      />
      <HistoryPanel
        title="Treasury transfer review"
        resource="treasuryTransfers"
        networks={data.networks}
        statusOptions={["unmatched", "ambiguous", "matched"]}
        refreshKey={historyRefreshKey}
        columns={[
          { header: "Asset", render: (row) => `${stringField(row, "network")} ${stringField(row, "token")}` },
          { header: "Amount", render: (row) => <span className="amount">{stringField(row, "amountFormatted")}</span> },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Tx", render: (row) => <CopyText value={stringField(row, "txHash")} /> },
          { header: "Detected", render: (row) => formatDate(stringField(row, "detectedAt")) },
          {
            header: "Match",
            render: (row) => (
              <TreasuryTransferMatchAction
                row={row}
                depositRequests={data.depositAddresses}
                onMatch={matchTreasuryTransfer}
              />
            )
          }
        ]}
      />
      <HistoryPanel
        title="Deposit transaction history"
        resource="deposits"
        networks={data.networks}
        statusOptions={["detected", "confirmed", "late"]}
        refreshKey={historyRefreshKey}
        columns={[
          { header: "Asset", render: (row) => `${stringField(row, "network")} ${stringField(row, "token")}` },
          { header: "Amount", render: (row) => <span className="amount">{stringField(row, "amountFormatted")}</span> },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Settlement", render: (row) => <SettlementStatus row={row} /> },
          { header: "Tx", render: (row) => <CopyText value={stringField(row, "txHash")} /> },
          { header: "Detected", render: (row) => formatDate(stringField(row, "detectedAt")) },
          {
            header: "Action",
            render: (row) => canRetrySettlement(row)
              ? (
                <button className="secondary compact-button" type="button" onClick={() => void retrySettlement(stringField(row, "id"))}>
                  <RefreshCw size={15} />Retry
                </button>
              )
              : "-"
          }
        ]}
      />
    </section>
  );
}

function TransfersPanel({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  return (
    <section className="stack">
      <Panel title="Create wallet transaction">
        <WalletTransactionForm data={data} token={token} mutate={mutate} />
      </Panel>
      <HistoryPanel
        title="Wallet transaction history"
        resource="walletTransactions"
        networks={data.networks}
        statusOptions={["submitted", "confirmed", "failed"]}
        columns={[
          { header: "Source", render: (row) => walletName(data.operationalWallets, data.merchants)(stringField(row, "sourceWalletId")) },
          { header: "Asset", render: (row) => `${stringField(row, "network")} ${stringField(row, "asset")}` },
          { header: "Amount", render: (row) => <span className="amount">{stringField(row, "amountFormatted")}</span> },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Tx / Error", render: (row) => stringField(row, "txHash") ? <CopyText value={stringField(row, "txHash")} /> : stringField(row, "failureReason") || "-" },
          { header: "Created", render: (row) => formatDate(stringField(row, "createdAt")) }
        ]}
      />
      <HistoryPanel
        title="Gas top-up history"
        resource="gasTopUps"
        networks={data.networks}
        statusOptions={["submitted", "confirmed", "failed"]}
        hideTokenFilter
        columns={[
          { header: "Network", render: (row) => stringField(row, "network") },
          { header: "Attempt", render: (row) => stringField(row, "attemptNumber") },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Tx / Error", render: (row) => stringField(row, "txHash") ? <CopyText value={stringField(row, "txHash")} /> : stringField(row, "failureReason") || "-" },
          { header: "Created", render: (row) => formatDate(stringField(row, "createdAt")) }
        ]}
      />
      <HistoryPanel
        title="Sweep history"
        resource="sweeps"
        networks={data.networks}
        statusOptions={["submitted", "confirmed", "failed"]}
        columns={[
          { header: "Asset", render: (row) => `${stringField(row, "network")} ${stringField(row, "token")}` },
          { header: "Attempt", render: (row) => stringField(row, "attemptNumber") },
          { header: "Amount", render: (row) => <span className="amount">{stringField(row, "amountFormatted")}</span> },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Tx / Error", render: (row) => stringField(row, "txHash") ? <CopyText value={stringField(row, "txHash")} /> : stringField(row, "failureReason") || "-" }
        ]}
      />
    </section>
  );
}

function WalletTransactionForm({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [sourceWalletId, setSourceWalletId] = useState(data.operationalWallets[0]?.id ?? "");
  const sourceWallet = data.operationalWallets.find((wallet) => wallet.id === sourceWalletId);
  const assetOptions = sourceWallet?.purpose === "treasury" && sourceWallet.token
    ? ["NATIVE", sourceWallet.token]
    : ["NATIVE"];
  const [asset, setAsset] = useState<TokenSymbol | "NATIVE">("NATIVE");
  const [savedDestination, setSavedDestination] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const destinationWallets = data.operationalWallets.filter((wallet) => wallet.id !== sourceWalletId && wallet.network === sourceWallet?.network);

  useEffect(() => {
    if (!assetOptions.includes(asset)) {
      setAsset(assetOptions[0] as TokenSymbol | "NATIVE");
    }
  }, [asset, assetOptions]);

  function selectDestination(id: string) {
    setSavedDestination(id);
    const wallet = data.operationalWallets.find((item) => item.id === id);
    if (wallet) {
      setToAddress(wallet.address);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate(apiPost("/dashboard/api/wallet-transactions", token, { sourceWalletId, asset, toAddress, amount }), "Wallet transaction submitted");
    setAmount("");
  }

  return (
    <form className="form-grid transaction-form" onSubmit={submit}>
      <Select label="Source" value={sourceWalletId} onChange={setSourceWalletId} options={data.operationalWallets.map((item) => item.id)} render={walletName(data.operationalWallets, data.merchants)} />
      <Select label="Asset" value={asset} onChange={(value) => setAsset(value as TokenSymbol | "NATIVE")} options={assetOptions} />
      <Select label="Saved destination" value={savedDestination} onChange={selectDestination} options={["", ...destinationWallets.map((item) => item.id)]} render={(value) => value ? walletName(data.operationalWallets, data.merchants)(value) : "External address"} />
      <label>
        Destination
        <input value={toAddress} onChange={(event) => setToAddress(event.target.value)} required />
      </label>
      <label>
        Amount
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      </label>
      <button className="primary"><Send size={16} />Submit</button>
    </form>
  );
}

function WebhooksPanel({ data }: { data: DashboardData }) {
  return (
    <section className="stack">
      <HistoryPanel
        title="Callback delivery history"
        resource="webhooks"
        networks={data.networks}
        statusOptions={["pending", "sent", "failed"]}
        hideNetworkFilter
        hideTokenFilter
        columns={[
          { header: "Type", render: (row) => stringField(row, "type") },
          { header: "Status", render: (row) => <StatusPill status={stringField(row, "status")} /> },
          { header: "Attempts", render: (row) => stringField(row, "attempts") },
          { header: "Response", render: (row) => stringField(row, "responseStatus") || stringField(row, "lastError") || "-" },
          { header: "Created", render: (row) => formatDate(stringField(row, "createdAt")) }
        ]}
      />
    </section>
  );
}

function SettlementStatus({ row }: { row: Record<string, unknown> }) {
  const status = stringField(row, "settlementStatus") || "pending";
  const step = stringField(row, "settlementStep");
  const reason = stringField(row, "settlementFailureReason");

  return (
    <div className="settlement-cell">
      <StatusPill status={status} />
      {step ? <small>{step}</small> : null}
      {reason ? <span>{reason}</span> : null}
    </div>
  );
}

function canRetrySettlement(row: Record<string, unknown>): boolean {
  const depositStatus = stringField(row, "status");
  return (
    (depositStatus === "confirmed" || depositStatus === "late") &&
    stringField(row, "settlementStatus") === "pending" &&
    Boolean(stringField(row, "settlementFailureReason"))
  );
}

function TreasuryTransferMatchAction({
  row,
  depositRequests,
  onMatch
}: {
  row: Record<string, unknown>;
  depositRequests: DepositAddress[];
  onMatch(treasuryTransferId: string, depositAddressId: string): Promise<void>;
}) {
  const candidates = depositRequests.filter((request) =>
    request.flow === "direct_treasury" &&
    request.status === "active" &&
    request.matchStatus === "pending" &&
    request.network === stringField(row, "network") &&
    request.token === stringField(row, "token") &&
    request.treasuryWalletId === stringField(row, "treasuryWalletId")
  );
  const [depositAddressId, setDepositAddressId] = useState(candidates[0]?.id ?? "");

  useEffect(() => {
    setDepositAddressId(candidates[0]?.id ?? "");
  }, [stringField(row, "id"), candidates.length]);

  if (stringField(row, "status") === "matched") {
    return stringField(row, "matchedDepositAddressId")
      ? <CopyText value={stringField(row, "matchedDepositAddressId")} />
      : "-";
  }

  if (candidates.length === 0) {
    return "-";
  }

  return (
    <div className="match-action">
      <select value={depositAddressId} onChange={(event) => setDepositAddressId(event.target.value)}>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.requestedAmountFormatted ?? candidate.id}
          </option>
        ))}
      </select>
      <button
        className="secondary compact-button"
        type="button"
        disabled={!depositAddressId}
        onClick={() => void onMatch(stringField(row, "id"), depositAddressId)}
      >
        <CheckCircle2 size={15} />Match
      </button>
    </div>
  );
}

interface HistoryColumn {
  header: string;
  render(row: Record<string, unknown>): React.ReactNode;
}

function HistoryPanel({
  title,
  resource,
  networks,
  statusOptions,
  columns,
  hideNetworkFilter = false,
  hideTokenFilter = false,
  refreshKey = 0
}: {
  title: string;
  resource: HistoryResource;
  networks: EnabledNetwork[];
  statusOptions: string[];
  columns: HistoryColumn[];
  hideNetworkFilter?: boolean;
  hideTokenFilter?: boolean;
  refreshKey?: number;
}) {
  const token = sessionStorage.getItem(tokenStorageKey) ?? "";
  const [status, setStatus] = useState("");
  const [network, setNetwork] = useState("");
  const [tokenFilter, setTokenFilter] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState("25");
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<HistoryResponse<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tokenOptions = network ? tokensForNetwork(networks, network) : ["USDT", "USDC"];

  async function load(nextOffset = offset) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        resource,
        limit,
        offset: String(nextOffset)
      });
      if (status) {
        params.set("status", status);
      }
      if (network && !hideNetworkFilter) {
        params.set("network", network);
      }
      if (tokenFilter && !hideTokenFilter) {
        params.set("token", tokenFilter);
      }
      if (query) {
        params.set("q", query);
      }

      const next = await apiGet<HistoryResponse<Record<string, unknown>>>(`/dashboard/api/history?${params}`, token);
      setResponse(next);
      setOffset(next.offset);
    } catch (historyError) {
      setError(errorMessage(historyError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOffset(0);
    void load(0);
  }, [resource, status, network, tokenFilter, limit, refreshKey]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    void load(0);
  }

  return (
    <Panel title={title}>
      <form className="history-toolbar" onSubmit={submitSearch}>
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="hash, address, id, URL" />
        </label>
        <Select label="Status" value={status} onChange={setStatus} options={["", ...statusOptions]} render={(value) => value || "All"} />
        {hideNetworkFilter ? null : (
          <Select label="Network" value={network} onChange={setNetwork} options={["", ...networks.map((item) => item.network)]} render={(value) => value || "All"} />
        )}
        {hideTokenFilter ? null : (
          <Select label="Token" value={tokenFilter} onChange={setTokenFilter} options={["", ...tokenOptions]} render={(value) => value || "All"} />
        )}
        <Select label="Rows" value={limit} onChange={setLimit} options={["10", "25", "50", "100"]} />
        <button className="secondary" disabled={loading}><RefreshCw size={16} />Apply</button>
      </form>
      {error ? <div className="notice error">{error}</div> : null}
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.header}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {(response?.items ?? []).map((row) => (
            <tr key={stringField(row, "id")}>
              {columns.map((column) => <td key={column.header}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pager">
        <span>{response ? `${response.total} records` : loading ? "Loading" : "No records"}</span>
        <div>
          <button className="secondary" disabled={response?.previousOffset === null || response?.previousOffset === undefined || loading} onClick={() => void load(response?.previousOffset ?? 0)}>
            Previous
          </button>
          <button className="secondary" disabled={response?.nextOffset === null || response?.nextOffset === undefined || loading} onClick={() => void load(response?.nextOffset ?? 0)}>
            Next
          </button>
        </div>
      </div>
    </Panel>
  );
}

function OperationalWalletsTable({ wallets }: { wallets: OperationalWallet[] }) {
  return (
    <table>
      <thead><tr><th>Label</th><th>Purpose</th><th>Asset</th><th>Address</th><th>Updated</th></tr></thead>
      <tbody>
        {wallets.map((wallet) => (
          <tr key={wallet.id}>
            <td>{wallet.label}</td>
            <td><StatusPill status={wallet.purpose as Status} /></td>
            <td>{wallet.network} {wallet.token ?? "NATIVE"}</td>
            <td><CopyText value={wallet.address} /></td>
            <td>{formatDate(wallet.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TreasuryWalletsTable({
  wallets,
  token,
  mutate
}: {
  wallets: TreasuryWallet[];
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  async function setDefault(wallet: TreasuryWallet) {
    await mutate(
      apiPost(`/dashboard/api/treasury-wallets/${wallet.id}/default`, token, {}),
      "Default treasury updated"
    );
  }

  return (
    <table>
      <thead><tr><th>Label</th><th>Asset</th><th>Default</th><th>ID</th><th>Address</th><th>Updated</th><th>Action</th></tr></thead>
      <tbody>
        {wallets.map((wallet) => (
          <tr key={wallet.id}>
            <td>{wallet.label}</td>
            <td>{wallet.network} {wallet.token}</td>
            <td>{wallet.isDefault ? <StatusPill status="default" /> : "-"}</td>
            <td><CopyText value={wallet.id} /></td>
            <td><CopyText value={wallet.address} /></td>
            <td>{formatDate(wallet.updatedAt)}</td>
            <td>
              {wallet.isDefault ? "-" : (
                <button className="secondary compact-button" type="button" onClick={() => void setDefault(wallet)}>
                  <CheckCircle2 size={15} />Default
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ApiKeysTable({ apiKeys }: { apiKeys: ApiKey[] }) {
  return (
    <table>
      <thead><tr><th>Status</th><th>Public key</th><th>Last used</th><th>Created</th></tr></thead>
      <tbody>
        {apiKeys.map((apiKey) => (
          <tr key={apiKey.id}>
            <td><StatusPill status={apiKey.status} /></td>
            <td><CopyText value={apiKey.publicKey} /></td>
            <td>{apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : "-"}</td>
            <td>{formatDate(apiKey.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DepositAddressesTable({ addresses }: { addresses: DepositAddress[] }) {
  return (
    <table>
      <thead><tr><th>Asset</th><th>Client</th><th>Status</th><th>Address</th><th>Expires</th></tr></thead>
      <tbody>
        {addresses.map((address) => (
          <tr key={address.id}>
            <td>{address.network} {address.token}</td>
            <td><CopyText value={address.clientId} /></td>
            <td><StatusPill status={address.status} /></td>
            <td><CopyText value={address.address} /></td>
            <td>{formatDate(address.expiresAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DepositsTable({ deposits, compact = false }: { deposits: Deposit[]; compact?: boolean }) {
  return (
    <table>
      <thead><tr><th>Asset</th><th>Amount</th><th>Status</th>{compact ? null : <th>Tx</th>}<th>Detected</th></tr></thead>
      <tbody>
        {deposits.map((deposit) => (
          <tr key={deposit.id}>
            <td>{deposit.network} {deposit.token}</td>
            <td className="amount">{deposit.amountFormatted}</td>
            <td><StatusPill status={deposit.status} /></td>
            {compact ? null : <td><CopyText value={deposit.txHash} /></td>}
            <td>{formatDate(deposit.detectedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WalletTransactionsTable({
  transactions,
  wallets,
  merchants,
  compact = false
}: {
  transactions: WalletTransaction[];
  wallets: OperationalWallet[];
  merchants: Merchant[];
  compact?: boolean;
}) {
  return (
    <table>
      <thead><tr><th>Source</th><th>Asset</th><th>Amount</th><th>Status</th>{compact ? null : <th>Tx</th>}<th>Created</th></tr></thead>
      <tbody>
        {transactions.map((transaction) => (
          <tr key={transaction.id}>
            <td>{walletName(wallets, merchants)(transaction.sourceWalletId)}</td>
            <td>{transaction.network} {transaction.asset}</td>
            <td className="amount">{transaction.amountFormatted}</td>
            <td><StatusPill status={transaction.status} /></td>
            {compact ? null : <td>{transaction.txHash ? <CopyText value={transaction.txHash} /> : transaction.failureReason ?? "-"}</td>}
            <td>{formatDate(transaction.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GasTopUpsTable({ topUps }: { topUps: GasTopUp[] }) {
  return (
    <table>
      <thead><tr><th>Network</th><th>Attempt</th><th>Status</th><th>Tx</th><th>Created</th></tr></thead>
      <tbody>
        {topUps.map((topUp) => (
          <tr key={topUp.id}>
            <td>{topUp.network}</td>
            <td>{topUp.attemptNumber}</td>
            <td><StatusPill status={topUp.status} /></td>
            <td>{topUp.txHash ? <CopyText value={topUp.txHash} /> : topUp.failureReason ?? "-"}</td>
            <td>{formatDate(topUp.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SweepsTable({ sweeps }: { sweeps: Sweep[] }) {
  return (
    <table>
      <thead><tr><th>Asset</th><th>Attempt</th><th>Amount</th><th>Status</th><th>Tx</th></tr></thead>
      <tbody>
        {sweeps.map((sweep) => (
          <tr key={sweep.id}>
            <td>{sweep.network} {sweep.token}</td>
            <td>{sweep.attemptNumber}</td>
            <td className="amount">{sweep.amountFormatted}</td>
            <td><StatusPill status={sweep.status} /></td>
            <td>{sweep.txHash ? <CopyText value={sweep.txHash} /> : sweep.failureReason ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">{title}</div>
      {children}
    </section>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  render = (item: string) => item
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: string[];
  render?(value: string): string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => <option key={item || "empty"} value={item}>{render(item)}</option>)}
      </select>
    </label>
  );
}

function StatusPill({ status }: { status: Status | string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  }

  return (
    <button className="copy-text" onClick={copy} title="Copy" type="button">
      <span>{shorten(value)}</span>
      <Copy size={13} />
      {copied ? <em>copied</em> : null}
    </button>
  );
}

function tokensForNetwork(networks: EnabledNetwork[], network: string): TokenSymbol[] {
  return networks.find((item) => item.network === network)?.tokens.map((token) => token.symbol) ?? [];
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function merchantName(merchants: Merchant[]) {
  return (id: string) => merchants.find((merchant) => merchant.id === id)?.name ?? shorten(id);
}

function walletName(wallets: OperationalWallet[], merchants: Merchant[]) {
  return (id: string) => {
    const wallet = wallets.find((item) => item.id === id);
    if (!wallet) {
      return shorten(id);
    }
    const owner = wallet.merchantId ? merchantName(merchants)(wallet.merchantId) : "Platform";
    return `${wallet.label} (${owner})`;
  };
}

function shorten(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  return apiRequest<T>(path, token);
}

async function apiPost<T>(path: string, token: string | undefined, body: unknown): Promise<T> {
  return apiRequest<T>(path, token, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function apiPut<T>(path: string, token: string | undefined, body: unknown): Promise<T> {
  return apiRequest<T>(path, token, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

async function apiRequest<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(payload?.error?.message ?? "Request failed", response.status);
  }

  return payload as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
