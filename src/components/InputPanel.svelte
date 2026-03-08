<script lang="ts">
  import type { SimulationInputs } from '../lib/types';

  interface Props {
    onrun: (inputs: SimulationInputs) => void;
  }

  let { onrun }: Props = $props();

  interface Asset {
    id: string;
    label: string;
    enabled: boolean;
    pct: number;
  }

  // ---- helpers ----
  const fmt      = (n: number) => Math.round(n).toLocaleString('en-US');
  const parseFmt = (s: string) => parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;

  function fmtOnBlur(getter: () => string, setter: (v: string) => void) {
    const n = parseFmt(getter());
    setter(n > 0 ? fmt(n) : '');
  }

  function stripOnFocus(getter: () => string, setter: (v: string) => void) {
    const n = parseFmt(getter());
    setter(n > 0 ? String(n) : '');
  }

  // ---- state ----
  let assets = $state<Asset[]>([
    { id: 'sp500', label: 'S&P 500',   enabled: true, pct: 60 },
    { id: 'tbond', label: 'US T-Bond', enabled: true, pct: 30 },
    { id: 'gold',  label: 'Gold',      enabled: true, pct: 10 },
  ]);

  let portfolioValueStr  = $state('1,000,000');
  let portfolioValue     = $derived(parseFmt(portfolioValueStr));

  let strategy    = $state<'constant-dollar' | 'percent-of-portfolio'>('constant-dollar');
  let constMode   = $state<'amount' | 'pct-of-initial'>('amount');
  let withdrawalAmountStr = $state('40,000');
  let withdrawalAmountNum = $derived(parseFmt(withdrawalAmountStr));
  let constPct    = $state(4);
  let withdrawalPct = $state(4);

  let inflation         = $state<'inflation-us' | 'inflation-singapore' | 'manual'>('inflation-us');
  let manualInflationPct = $state(3);
  let durationYears = $state(30);

  // ---- allocation mode ----
  let allocationMode = $state<'static' | 'glidepath'>('static');

  // Glidepath params
  let glideStepCondition = $state<'unconditional' | 'sp500-ath'>('unconditional');
  let glideStepSize      = $state(5);
  let glideAthThreshold  = $state(5);

  // Final allocation (glidepath mode)
  let finalAssets = $state<Asset[]>([
    { id: 'sp500', label: 'S&P 500',   enabled: true, pct: 80 },
    { id: 'tbond', label: 'US T-Bond', enabled: true, pct: 10 },
    { id: 'gold',  label: 'Gold',      enabled: true, pct: 10 },
  ]);

  // ---- derived validation ----
  let enabledCount  = $derived(assets.filter(a => a.enabled).length);
  let allocationSum = $derived(assets.reduce((s, a) => s + (a.enabled ? a.pct : 0), 0));
  let finalAllocationSum = $derived(finalAssets.reduce((s, a) => s + (a.enabled ? a.pct : 0), 0));

  let effectiveWithdrawalAmount = $derived(
    constMode === 'amount'
      ? withdrawalAmountNum
      : portfolioValue * constPct / 100
  );

  let withdrawalInvalid = $derived(
    (strategy === 'constant-dollar' && effectiveWithdrawalAmount <= 0) ||
    (strategy === 'percent-of-portfolio' && withdrawalPct <= 0)
  );

  let isValid = $derived(
    allocationSum === 100 &&
    enabledCount >= 1 &&
    portfolioValue > 0 &&
    durationYears >= 1 &&
    !withdrawalInvalid &&
    (allocationMode === 'static' || (finalAllocationSum === 100 && glideStepSize > 0))
  );

  // ---- stale indicator ----
  let hasRun = $state(false);
  let dirty  = $state(false);

  let _initialized = false;
  $effect(() => {
    portfolioValueStr;
    strategy; constMode; withdrawalAmountStr; constPct; withdrawalPct;
    inflation; manualInflationPct; durationYears;
    assets.forEach(a => { a.enabled; a.pct; });
    allocationMode; glideStepCondition; glideStepSize; glideAthThreshold;
    finalAssets.forEach(a => { a.enabled; a.pct; });

    if (!_initialized) { _initialized = true; return; }
    if (hasRun) dirty = true;
  });

  // ---- allocation logic ----
  function toggleAsset(idx: number) {
    const asset = assets[idx];
    if (asset.enabled && enabledCount === 1) return;
    asset.enabled = !asset.enabled;
    if (!asset.enabled) asset.pct = 0;
    // Mirror enabled state in finalAssets
    finalAssets[idx].enabled = asset.enabled;
    if (!finalAssets[idx].enabled) finalAssets[idx].pct = 0;
  }

  function handleRun() {
    if (!isValid) return;
    hasRun = true;
    dirty  = false;
    const enabledAllocations = assets.filter(a => a.enabled).map(a => ({ id: a.id, pct: a.pct }));
    onrun({
      portfolioValue,
      allocations: enabledAllocations,
      strategy,
      withdrawalAmount: effectiveWithdrawalAmount,
      withdrawalPct,
      inflationSeries: inflation,
      manualInflationRate: manualInflationPct,
      durationYears,
      allocationMode,
      glidepath: allocationMode === 'glidepath' ? {
        finalAllocations: finalAssets.filter(a => a.enabled).map(a => ({ id: a.id, pct: a.pct })),
        stepCondition: glideStepCondition,
        stepSize: glideStepSize,
        athThreshold: glideAthThreshold,
      } : undefined,
    });
  }
</script>

<aside class="input-panel">

  <section class="card">
    <h2>Portfolio</h2>
    <label class="field">
      <span>Initial value</span>
      <div class="input-adorn">
        <span class="adorn-left">$</span>
        <input
          type="text"
          inputmode="numeric"
          bind:value={portfolioValueStr}
          onfocus={() => stripOnFocus(() => portfolioValueStr, v => (portfolioValueStr = v))}
          onblur={() => fmtOnBlur(() => portfolioValueStr, v => (portfolioValueStr = v))}
        />
      </div>
    </label>
  </section>

  <section class="card">
    <h2>Asset Allocation</h2>
    <select bind:value={allocationMode}>
      <option value="static">Static</option>
      <option value="glidepath">Glidepath</option>
    </select>

    {#if allocationMode === 'static'}
      {#each assets as asset, i}
        <div class="asset-row" class:faded={!asset.enabled}>
          <label class="asset-check">
            <input
              type="checkbox"
              checked={asset.enabled}
              disabled={asset.enabled && enabledCount === 1}
              onchange={() => toggleAsset(i)}
            />
            <span>{asset.label}</span>
          </label>
          <div class="pct-wrap">
            <input type="number" min="0" max="100" bind:value={asset.pct} disabled={!asset.enabled} />
            <span>%</span>
          </div>
        </div>
      {/each}
      <div class="alloc-total" class:error={allocationSum !== 100}>
        Total: {allocationSum}%
      </div>

    {:else}
      <!-- Glidepath params -->
      <label class="field">
        <span>Step condition</span>
        <select bind:value={glideStepCondition}>
          <option value="unconditional">Unconditional</option>
          <option value="sp500-ath">S&amp;P 500 within x% of ATH</option>
        </select>
      </label>
      {#if glideStepCondition === 'sp500-ath'}
        <label class="field">
          <span>x (ATH threshold)</span>
          <div class="input-adorn">
            <input type="number" min="0" max="100" step="0.1" bind:value={glideAthThreshold} />
            <span class="adorn-right">%</span>
          </div>
        </label>
      {/if}
      <label class="field">
        <span>Step size</span>
        <div class="input-adorn">
          <input type="number" min="0" max="100" step="0.01" bind:value={glideStepSize} />
          <span class="adorn-right">%</span>
        </div>
      </label>

      <!-- Two-column allocation table -->
      <div class="glide-alloc">
        <div class="glide-col-headers">
          <span class="glide-asset-header">Asset</span>
          <span class="glide-pct-header">Initial</span>
          <span class="glide-pct-header">Final</span>
        </div>
        {#each assets as asset, i}
          <div class="glide-row" class:faded={!asset.enabled}>
            <label class="asset-check">
              <input
                type="checkbox"
                checked={asset.enabled}
                disabled={asset.enabled && enabledCount === 1}
                onchange={() => toggleAsset(i)}
              />
              <span>{asset.label}</span>
            </label>
            <div class="pct-wrap">
              <input type="number" min="0" max="100" bind:value={asset.pct} disabled={!asset.enabled} />
              <span>%</span>
            </div>
            <div class="pct-wrap">
              <input type="number" min="0" max="100" bind:value={finalAssets[i].pct} disabled={!asset.enabled} />
              <span>%</span>
            </div>
          </div>
        {/each}
        <div class="glide-totals">
          <span></span>
          <span class="alloc-total" class:error={allocationSum !== 100}>{allocationSum}%</span>
          <span class="alloc-total" class:error={finalAllocationSum !== 100}>{finalAllocationSum}%</span>
        </div>
      </div>
    {/if}
  </section>

  <section class="card">
    <h2>Withdrawal Strategy</h2>
    <select bind:value={strategy}>
      <option value="constant-dollar">Constant dollar</option>
      <option value="percent-of-portfolio">Percent of portfolio</option>
    </select>

    {#if strategy === 'constant-dollar'}
      <p class="sub-label">Initial withdrawal</p>
      <div class="radio-group sub-radio">
        <label>
          <input type="radio" bind:group={constMode} value="amount" />
          Dollar amount
        </label>
        <label>
          <input type="radio" bind:group={constMode} value="pct-of-initial" />
          % of initial portfolio
        </label>
      </div>

      {#if constMode === 'amount'}
        <label class="field">
          <span>Annual withdrawal</span>
          <div class="input-adorn">
            <span class="adorn-left">$</span>
            <input
              type="text"
              inputmode="numeric"
              bind:value={withdrawalAmountStr}
              onfocus={() => stripOnFocus(() => withdrawalAmountStr, v => (withdrawalAmountStr = v))}
              onblur={() => fmtOnBlur(() => withdrawalAmountStr, v => (withdrawalAmountStr = v))}
            />
          </div>
        </label>
      {:else}
        <label class="field">
          <span>Annual withdrawal</span>
          <div class="input-adorn">
            <input type="number" min="0" max="100" step="0.1" bind:value={constPct} />
            <span class="adorn-right">%</span>
          </div>
        </label>
        <p class="derived-hint">= ${fmt(effectiveWithdrawalAmount)} / yr</p>
      {/if}
    {:else}
      <label class="field">
        <span>Annual withdrawal</span>
        <div class="input-adorn">
          <input type="number" min="0" max="100" step="0.1" bind:value={withdrawalPct} />
          <span class="adorn-right">%</span>
        </div>
      </label>
    {/if}

    {#if withdrawalInvalid}
      <p class="error-msg">Withdrawal amount must be above 0.</p>
    {/if}
  </section>

  <section class="card">
    <h2>Inflation</h2>
    <select bind:value={inflation}>
      <option value="inflation-us">US CPI (1914–2025)</option>
      <option value="inflation-singapore">Singapore CPI (1962–2025)</option>
      <option value="manual">Manual</option>
    </select>
    {#if inflation === 'manual'}
      <label class="field">
        <span>Annual rate</span>
        <div class="input-adorn">
          <input type="number" step="0.1" bind:value={manualInflationPct} />
          <span class="adorn-right">%</span>
        </div>
      </label>
    {/if}
  </section>

  <section class="card">
    <h2>Duration</h2>
    <label class="field">
      <span>Years in retirement</span>
      <div class="input-adorn">
        <input type="number" min="1" max="60" bind:value={durationYears} />
        <span class="adorn-right">yrs</span>
      </div>
    </label>
  </section>

  <button class="run-btn" onclick={handleRun} disabled={!isValid}>
    Run Simulation
  </button>

  {#if dirty}
    <p class="stale-msg">Run Simulation to refresh results.</p>
  {/if}

</aside>

<style>
  .input-panel {
    width: 340px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    overflow-y: auto;
    border-right: 1px solid #e5e7eb;
    background: #f9fafb;
  }

  .card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  h2 {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9ca3af;
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: #374151;
  }

  .input-adorn {
    display: flex;
    align-items: stretch;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    overflow: hidden;
  }

  .input-adorn input {
    flex: 1;
    min-width: 0;
    border: none;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    color: #111827;
    background: white;
    outline: none;
  }

  .adorn-left,
  .adorn-right {
    padding: 0.375rem 0.5rem;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 0.875rem;
    border-right: 1px solid #d1d5db;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .adorn-right {
    border-right: none;
    border-left: 1px solid #d1d5db;
  }

  input[type="number"] {
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    color: #111827;
    background: white;
  }

  .derived-hint {
    margin: 0;
    font-size: 0.8rem;
    color: #6b7280;
    text-align: right;
  }

  .error-msg {
    margin: 0;
    font-size: 0.8rem;
    color: #ef4444;
  }

  /* ---- static allocation rows ---- */
  .asset-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .asset-row.faded {
    opacity: 0.4;
  }

  .asset-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #111827;
    cursor: pointer;
    user-select: none;
    flex: 1;
  }

  .asset-check input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    accent-color: #3b82f6;
    cursor: pointer;
  }

  .pct-wrap {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .pct-wrap input[type="number"] {
    width: 46px;
    text-align: right;
    padding: 0.25rem 0.375rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
  }

  .pct-wrap span {
    font-size: 0.8rem;
    color: #6b7280;
    width: 1rem;
  }

  .alloc-total {
    font-size: 0.75rem;
    color: #9ca3af;
    text-align: right;
  }

  .alloc-total.error {
    color: #ef4444;
    font-weight: 600;
  }

  /* ---- glidepath two-column layout ---- */
  .glide-alloc {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .glide-col-headers {
    display: grid;
    grid-template-columns: 1fr 62px 62px;
    gap: 0.25rem;
    padding-bottom: 0.125rem;
    border-bottom: 1px solid #f3f4f6;
  }

  .glide-asset-header {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
  }

  .glide-pct-header {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
    text-align: right;
    padding-right: 1rem;
  }

  .glide-row {
    display: grid;
    grid-template-columns: 1fr 62px 62px;
    align-items: center;
    gap: 0.25rem;
  }

  .glide-row.faded {
    opacity: 0.4;
  }

  .glide-totals {
    display: grid;
    grid-template-columns: 1fr 62px 62px;
    gap: 0.25rem;
    margin-top: 0.125rem;
    border-top: 1px solid #f3f4f6;
    padding-top: 0.25rem;
  }

  .glide-totals .alloc-total {
    text-align: right;
    padding-right: 1rem;
  }

  /* ---- radio groups ---- */
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    font-size: 0.875rem;
  }

  .radio-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: #374151;
  }

  .radio-group input[type="radio"] {
    accent-color: #3b82f6;
  }

  .sub-label {
    margin: 0.25rem 0 0.1rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .sub-radio {
    padding-left: 1.25rem;
    border-left: 2px solid #e5e7eb;
  }

  /* ---- select ---- */
  select {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    color: #111827;
    background: white;
    cursor: pointer;
  }

  /* ---- run button ---- */
  .run-btn {
    width: 100%;
    padding: 0.625rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .run-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .run-btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
  }

  .stale-msg {
    margin: 0;
    font-size: 0.75rem;
    color: #f59e0b;
    text-align: center;
    font-style: italic;
  }

  @media (max-width: 768px) {
    .input-panel {
      width: 100%;
      height: auto;
      overflow-y: visible;
      border-right: none;
      border-bottom: 1px solid #e5e7eb;
    }
  }
</style>
