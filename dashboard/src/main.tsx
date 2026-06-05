import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRightLeft,
  BellRing,
  CheckCircle2,
  Coins,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet
} from "lucide-react";
import "./styles.css";

type NetworkKind = "evm" | "tron";
type TokenSymbol = "USDT" | "USDC";
type WalletPurpose = "gas" | "treasury";
type Status = "active" | "expired" | "detected" | "confirmed" | "late" | "submitted" | "failed" | "pending" | "sent";

interface Merchant {
  id: string;
  name: string;
  status: string;
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
  status: "active" | "expired";
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
  detectedAt: string;
  confirmedAt: string | null;
}

interface GasTopUp {
  id: string;
  merchantId: string;
  network: string;
  txHash: string | null;
  amountWei: string;
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
  webhookConfigs: WebhookConfig[];
  networks: EnabledNetwork[];
  treasuryWallets: TreasuryWallet[];
  operationalWallets: OperationalWallet[];
  depositAddresses: DepositAddress[];
  deposits: Deposit[];
  gasTopUps: GasTopUp[];
  sweeps: Sweep[];
  walletTransactions: WalletTransaction[];
  webhooks: WebhookEvent[];
}

interface Overview {
  stats: Record<string, number>;
  recentDeposits: Deposit[];
  recentWalletTransactions: WalletTransaction[];
  recentWebhooks: WebhookEvent[];
}

type Tab = "overview" | "merchants" | "wallets" | "deposits" | "transfers" | "webhooks";

const tokenStorageKey = "crypto-dashboard-token";
const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "overview", label: "Overview", icon: ShieldCheck },
  { id: "merchants", label: "Merchants", icon: KeyRound },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "deposits", label: "Deposits", icon: Coins },
  { id: "transfers", label: "Transfers", icon: ArrowRightLeft },
  { id: "webhooks", label: "Webhooks", icon: BellRing }
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
        apiGet<DashboardData>("/dashboard/api/data?limit=200", currentToken)
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
            <span>Admin dashboard</span>
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
          <button className="secondary" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} />
            Refresh
          </button>
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
            <span>Admin dashboard</span>
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
    case "merchants":
      return <MerchantsPanel data={data} token={token} mutate={mutate} />;
    case "wallets":
      return <WalletsPanel data={data} token={token} mutate={mutate} />;
    case "deposits":
      return <DepositsPanel data={data} />;
    case "transfers":
      return <TransfersPanel data={data} token={token} mutate={mutate} />;
    case "webhooks":
      return <WebhooksPanel data={data} />;
  }
}

function OverviewPanel({ overview, data }: { overview: Overview; data: DashboardData }) {
  const statItems = [
    ["Merchants", overview.stats.merchants ?? 0],
    ["Active temp wallets", overview.stats.activeDepositAddresses ?? 0],
    ["Confirmed deposits", overview.stats.confirmedDeposits ?? 0],
    ["Pending webhooks", overview.stats.pendingWebhooks ?? 0],
    ["Operational wallets", overview.stats.operationalWallets ?? 0],
    ["Submitted transfers", overview.stats.submittedWalletTransactions ?? 0]
  ];

  return (
    <section className="stack">
      <div className="metric-grid">
        {statItems.map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="split-grid">
        <Panel title="Recent deposits">
          <DepositsTable deposits={overview.recentDeposits} merchants={data.merchants} compact />
        </Panel>
        <Panel title="Wallet transactions">
          <WalletTransactionsTable transactions={overview.recentWalletTransactions} wallets={data.operationalWallets} merchants={data.merchants} compact />
        </Panel>
      </div>
    </section>
  );
}

function MerchantsPanel({
  data,
  token,
  mutate
}: {
  data: DashboardData;
  token: string;
  mutate<T>(request: Promise<T>, successMessage: string): Promise<T | undefined>;
}) {
  const [name, setName] = useState("");
  const [selectedMerchantId, setSelectedMerchantId] = useState(data.merchants[0]?.id ?? "");
  const [apiKeyResult, setApiKeyResult] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookActive, setWebhookActive] = useState(true);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate(apiPost("/dashboard/api/merchants", token, { name }), "Merchant created");
    setName("");
  }

  async function createApiKey(event: FormEvent) {
    event.preventDefault();
    const result = await mutate<{ apiKey: string; apiSecret: string }>(
      apiPost(`/dashboard/api/merchants/${selectedMerchantId}/api-keys`, token, {}),
      "API key created"
    );
    if (result) {
      setApiKeyResult(result);
    }
  }

  async function configureWebhook(event: FormEvent) {
    event.preventDefault();
    await mutate(
      apiPut(`/dashboard/api/merchants/${selectedMerchantId}/webhook`, token, {
        url: webhookUrl,
        secret: webhookSecret || undefined,
        active: webhookActive
      }),
      "Webhook configured"
    );
    setWebhookSecret("");
  }

  return (
    <section className="stack">
      <Panel title="Create merchant">
        <form className="inline-form" onSubmit={submit}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <button className="primary"><Plus size={16} />Create</button>
        </form>
      </Panel>
      <div className="split-grid">
        <Panel title="Create API key">
          <form className="form-grid" onSubmit={createApiKey}>
            <Select label="Merchant" value={selectedMerchantId} onChange={setSelectedMerchantId} options={data.merchants.map((item) => item.id)} render={merchantName(data.merchants)} />
            <button className="primary"><KeyRound size={16} />Create key</button>
          </form>
          {apiKeyResult ? (
            <div className="secret-box">
              <div><span>API key</span><CopyText value={apiKeyResult.apiKey} /></div>
              <div><span>API secret</span><CopyText value={apiKeyResult.apiSecret} /></div>
            </div>
          ) : null}
        </Panel>
        <Panel title="Configure webhook">
          <form className="form-grid" onSubmit={configureWebhook}>
            <Select label="Merchant" value={selectedMerchantId} onChange={setSelectedMerchantId} options={data.merchants.map((item) => item.id)} render={merchantName(data.merchants)} />
            <label>
              URL
              <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} required />
            </label>
            <label>
              Secret
              <input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={webhookActive} onChange={(event) => setWebhookActive(event.target.checked)} />
              Active
            </label>
            <button className="primary"><ShieldCheck size={16} />Save</button>
          </form>
        </Panel>
      </div>
      <Panel title="Merchants">
        <table>
          <thead><tr><th>Name</th><th>Status</th><th>ID</th><th>Created</th></tr></thead>
          <tbody>
            {data.merchants.map((merchant) => (
              <tr key={merchant.id}>
                <td>{merchant.name}</td>
                <td><StatusPill status={merchant.status as Status} /></td>
                <td><CopyText value={merchant.id} /></td>
                <td>{formatDate(merchant.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="split-grid">
        <Panel title="API keys">
          <ApiKeysTable apiKeys={data.apiKeys} merchants={data.merchants} />
        </Panel>
        <Panel title="Webhook configs">
          <WebhookConfigsTable configs={data.webhookConfigs} merchants={data.merchants} />
        </Panel>
      </div>
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
        <OperationalWalletsTable wallets={data.operationalWallets} merchants={data.merchants} />
      </Panel>
      <Panel title="Treasury wallets">
        <TreasuryWalletsTable wallets={data.treasuryWallets} merchants={data.merchants} />
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
  const [merchantId, setMerchantId] = useState(data.merchants[0]?.id ?? "");
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
      apiPost("/dashboard/api/wallets/treasury", token, { merchantId, network, token: tokenSymbol, label: label || undefined }),
      "Treasury wallet generated"
    );
    setLabel("");
  }

  return (
    <Panel title="Generate treasury wallet">
      <form className="form-grid" onSubmit={submit}>
        <Select label="Merchant" value={merchantId} onChange={setMerchantId} options={data.merchants.map((item) => item.id)} render={merchantName(data.merchants)} />
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
  const [merchantId, setMerchantId] = useState(data.merchants[0]?.id ?? "");
  const [network, setNetwork] = useState(data.networks[0]?.network ?? "");
  const [tokenSymbol, setTokenSymbol] = useState<TokenSymbol>("USDT");
  const [address, setAddress] = useState("");
  const tokens = tokensForNetwork(data.networks, network);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate(apiPost("/dashboard/api/treasury-wallets", token, { merchantId, network, token: tokenSymbol, address }), "Treasury wallet registered");
    setAddress("");
  }

  return (
    <form className="inline-form wide" onSubmit={submit}>
      <Select label="Merchant" value={merchantId} onChange={setMerchantId} options={data.merchants.map((item) => item.id)} render={merchantName(data.merchants)} />
      <Select label="Network" value={network} onChange={setNetwork} options={data.networks.map((item) => item.network)} />
      <Select label="Token" value={tokenSymbol} onChange={(value) => setTokenSymbol(value as TokenSymbol)} options={tokens} />
      <label className="grow">
        Address
        <input value={address} onChange={(event) => setAddress(event.target.value)} required />
      </label>
      <button className="primary"><Plus size={16} />Register</button>
    </form>
  );
}

function DepositsPanel({ data }: { data: DashboardData }) {
  return (
    <section className="stack">
      <Panel title="Deposit addresses">
        <DepositAddressesTable addresses={data.depositAddresses} merchants={data.merchants} />
      </Panel>
      <Panel title="Deposits">
        <DepositsTable deposits={data.deposits} merchants={data.merchants} />
      </Panel>
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
      <Panel title="Wallet transactions">
        <WalletTransactionsTable transactions={data.walletTransactions} wallets={data.operationalWallets} merchants={data.merchants} />
      </Panel>
      <div className="split-grid">
        <Panel title="Gas top-ups">
          <GasTopUpsTable topUps={data.gasTopUps} merchants={data.merchants} />
        </Panel>
        <Panel title="Sweeps">
          <SweepsTable sweeps={data.sweeps} merchants={data.merchants} />
        </Panel>
      </div>
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
      <Panel title="Webhook events">
        <table>
          <thead><tr><th>Type</th><th>Merchant</th><th>Status</th><th>Attempts</th><th>Response</th><th>Created</th></tr></thead>
          <tbody>
            {data.webhooks.map((event) => (
              <tr key={event.id}>
                <td>{event.type}</td>
                <td>{merchantName(data.merchants)(event.merchantId)}</td>
                <td><StatusPill status={event.status} /></td>
                <td>{event.attempts}</td>
                <td>{event.responseStatus ?? event.lastError ?? "-"}</td>
                <td>{formatDate(event.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function OperationalWalletsTable({ wallets, merchants }: { wallets: OperationalWallet[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Label</th><th>Purpose</th><th>Merchant</th><th>Asset</th><th>Address</th><th>Updated</th></tr></thead>
      <tbody>
        {wallets.map((wallet) => (
          <tr key={wallet.id}>
            <td>{wallet.label}</td>
            <td><StatusPill status={wallet.purpose as Status} /></td>
            <td>{wallet.merchantId ? merchantName(merchants)(wallet.merchantId) : "Platform"}</td>
            <td>{wallet.network} {wallet.token ?? "NATIVE"}</td>
            <td><CopyText value={wallet.address} /></td>
            <td>{formatDate(wallet.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TreasuryWalletsTable({ wallets, merchants }: { wallets: TreasuryWallet[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Network</th><th>Token</th><th>Address</th><th>Updated</th></tr></thead>
      <tbody>
        {wallets.map((wallet) => (
          <tr key={wallet.id}>
            <td>{merchantName(merchants)(wallet.merchantId)}</td>
            <td>{wallet.network}</td>
            <td>{wallet.token}</td>
            <td><CopyText value={wallet.address} /></td>
            <td>{formatDate(wallet.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ApiKeysTable({ apiKeys, merchants }: { apiKeys: ApiKey[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Status</th><th>Public key</th><th>Last used</th><th>Created</th></tr></thead>
      <tbody>
        {apiKeys.map((apiKey) => (
          <tr key={apiKey.id}>
            <td>{merchantName(merchants)(apiKey.merchantId)}</td>
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

function WebhookConfigsTable({ configs, merchants }: { configs: WebhookConfig[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Status</th><th>URL</th><th>Updated</th></tr></thead>
      <tbody>
        {configs.map((config) => (
          <tr key={config.merchantId}>
            <td>{merchantName(merchants)(config.merchantId)}</td>
            <td><StatusPill status={config.active ? "active" : "disabled"} /></td>
            <td><CopyText value={config.url} /></td>
            <td>{formatDate(config.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DepositAddressesTable({ addresses, merchants }: { addresses: DepositAddress[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Asset</th><th>Status</th><th>Address</th><th>Expires</th></tr></thead>
      <tbody>
        {addresses.map((address) => (
          <tr key={address.id}>
            <td>{merchantName(merchants)(address.merchantId)}</td>
            <td>{address.network} {address.token}</td>
            <td><StatusPill status={address.status} /></td>
            <td><CopyText value={address.address} /></td>
            <td>{formatDate(address.expiresAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DepositsTable({ deposits, merchants, compact = false }: { deposits: Deposit[]; merchants: Merchant[]; compact?: boolean }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Asset</th><th>Amount</th><th>Status</th>{compact ? null : <th>Tx</th>}<th>Detected</th></tr></thead>
      <tbody>
        {deposits.map((deposit) => (
          <tr key={deposit.id}>
            <td>{merchantName(merchants)(deposit.merchantId)}</td>
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

function GasTopUpsTable({ topUps, merchants }: { topUps: GasTopUp[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Network</th><th>Status</th><th>Tx</th><th>Created</th></tr></thead>
      <tbody>
        {topUps.map((topUp) => (
          <tr key={topUp.id}>
            <td>{merchantName(merchants)(topUp.merchantId)}</td>
            <td>{topUp.network}</td>
            <td><StatusPill status={topUp.status} /></td>
            <td>{topUp.txHash ? <CopyText value={topUp.txHash} /> : topUp.failureReason ?? "-"}</td>
            <td>{formatDate(topUp.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SweepsTable({ sweeps, merchants }: { sweeps: Sweep[]; merchants: Merchant[] }) {
  return (
    <table>
      <thead><tr><th>Merchant</th><th>Asset</th><th>Amount</th><th>Status</th><th>Tx</th></tr></thead>
      <tbody>
        {sweeps.map((sweep) => (
          <tr key={sweep.id}>
            <td>{merchantName(merchants)(sweep.merchantId)}</td>
            <td>{sweep.network} {sweep.token}</td>
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
      <select value={value} onChange={(event) => onChange(event.target.value)} required>
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
