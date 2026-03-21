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
    { id: 'tbond', label: 'US T-Bond (10Y)', enabled: true, pct: 30 },
    { id: 'gold',  label: 'Gold',      enabled: true, pct: 10 },
  ]);

  let portfolioValueStr  = $state('1,000,000');
  let portfolioValue     = $derived(parseFmt(portfolioValueStr));

  let strategy    = $state<'constant-dollar' | 'percent-of-portfolio' | 'cape' | 'tobin'>('constant-dollar');
  let constMode   = $state<'amount' | 'pct-of-initial'>('amount');
  let withdrawalAmountStr = $state('40,000');
  let withdrawalAmountNum = $derived(parseFmt(withdrawalAmountStr));
  let constPct    = $state(4);
  let withdrawalPct = $state(4);
  let capeBasePct    = $state(1.95);
  let capeMultiplier = $state(0.35);

  // Bounds (percent-of-portfolio and cape only)
  let floorEnabled    = $state(false);
  let ceilEnabled     = $state(false);
  // Percent-of-portfolio: always dollar
  let pctFloorValue   = $state(20000);
  let pctCeilValue    = $state(100000);
  // CAPE: pct or dollar
  let floorType       = $state<'pct' | 'dollar'>('pct');
  let floorValue      = $state(2);
  let ceilType        = $state<'pct' | 'dollar'>('pct');
  let ceilValue       = $state(6);

  // Tobin / Yale
  let tobinPrevYearPct     = $state(70);
  let tobinSpendingRate    = $state(5);
  let tobinInflationAdjust = $state(false);
  let tobinFloorEnabled    = $state(false);
  let tobinFloorValue      = $state(20000);
  let tobinCeilEnabled     = $state(false);
  let tobinCeilValue       = $state(100000);

  // Strategy info overlay
  let showStrategyInfo = $state(false);

  let inflation         = $state<'inflation-us' | 'inflation-singapore' | 'manual'>('inflation-us');
  let manualInflationPct = $state(3);
  let durationYears = $state(30);
  let startYearMin  = $state<number | null>(null);
  let startYearMax  = $state<number | null>(null);

  // ---- allocation mode ----
  let allocationMode = $state<'static' | 'glidepath'>('static');

  // Glidepath params
  let glideStepCondition = $state<'unconditional' | 'sp500-ath'>('unconditional');
  let glideStepSize      = $state(5);
  let glideAthThreshold  = $state(5);

  // Final allocation (glidepath mode)
  let finalAssets = $state<Asset[]>([
    { id: 'sp500', label: 'S&P 500',   enabled: true, pct: 80 },
    { id: 'tbond', label: 'US T-Bond (10Y)', enabled: true, pct: 10 },
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

  let yearFilterInvalid = $derived(
    startYearMin !== null && startYearMax !== null && startYearMin > startYearMax
  );

  let tobinInvalid = $derived(
    tobinPrevYearPct < 0 || tobinPrevYearPct > 100 ||
    tobinSpendingRate < 0 || tobinSpendingRate > 100
  );

  let withdrawalInvalid = $derived(
    (strategy === 'constant-dollar'      && effectiveWithdrawalAmount <= 0) ||
    (strategy === 'percent-of-portfolio' && withdrawalPct <= 0) ||
    (strategy === 'cape'                 && (capeBasePct < 0 || capeMultiplier <= 0)) ||
    (strategy === 'tobin'                && tobinInvalid)
  );

  // Bounds conflict — hard block when floor > ceiling in same unit
  let boundsHardConflict = $derived(
    (strategy === 'percent-of-portfolio' && floorEnabled && ceilEnabled && pctFloorValue > pctCeilValue) ||
    (strategy === 'cape'  && floorEnabled && ceilEnabled && floorType === ceilType && floorValue > ceilValue) ||
    (strategy === 'tobin' && tobinFloorEnabled && tobinCeilEnabled && tobinFloorValue > tobinCeilValue)
  );

  // Cross-type soft warning (CAPE only — pct-of-portfolio can't have cross-type conflict)
  let floorDollarAtStart = $derived(
    floorEnabled && strategy === 'cape'
      ? (floorType === 'pct' ? portfolioValue * floorValue / 100 : floorValue)
      : 0
  );
  let ceilDollarAtStart = $derived(
    ceilEnabled && strategy === 'cape'
      ? (ceilType === 'pct' ? portfolioValue * ceilValue / 100 : ceilValue)
      : Infinity
  );
  let boundsSoftConflict = $derived(
    strategy === 'cape' &&
    floorEnabled && ceilEnabled &&
    floorType !== ceilType &&
    floorDollarAtStart > ceilDollarAtStart
  );

  let isValid = $derived(
    allocationSum === 100 &&
    enabledCount >= 1 &&
    portfolioValue > 0 &&
    durationYears >= 1 &&
    !withdrawalInvalid &&
    !boundsHardConflict &&
    !yearFilterInvalid &&
    (allocationMode === 'static' || (finalAllocationSum === 100 && glideStepSize > 0))
  );

  // ---- stale indicator ----
  let hasRun = $state(false);
  let dirty  = $state(false);

  let _initialized = false;
  $effect(() => {
    portfolioValueStr;
    strategy; constMode; withdrawalAmountStr; constPct; withdrawalPct;
    capeBasePct; capeMultiplier;
    floorEnabled; pctFloorValue; pctCeilValue; ceilEnabled; floorType; floorValue; ceilType; ceilValue;
    tobinPrevYearPct; tobinSpendingRate; tobinInflationAdjust;
    tobinFloorEnabled; tobinFloorValue; tobinCeilEnabled; tobinCeilValue;
    inflation; manualInflationPct; durationYears; startYearMin; startYearMax;
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
      capeBasePct,
      capeMultiplier,
      tobinPrevYearPct,
      tobinSpendingRate,
      tobinInflationAdjust,
      withdrawalFloor:
        strategy === 'percent-of-portfolio' ? (floorEnabled  ? { type: 'dollar', value: pctFloorValue  } : null) :
        strategy === 'tobin'                ? (tobinFloorEnabled ? { type: 'dollar', value: tobinFloorValue } : null) :
        strategy === 'cape'                 ? (floorEnabled  ? { type: floorType,  value: floorValue   } : null) :
        null,
      withdrawalCeiling:
        strategy === 'percent-of-portfolio' ? (ceilEnabled   ? { type: 'dollar', value: pctCeilValue   } : null) :
        strategy === 'tobin'                ? (tobinCeilEnabled  ? { type: 'dollar', value: tobinCeilValue  } : null) :
        strategy === 'cape'                 ? (ceilEnabled   ? { type: ceilType,   value: ceilValue    } : null) :
        null,
      inflationSeries: inflation,
      manualInflationRate: manualInflationPct,
      durationYears,
      startYearMin,
      startYearMax,
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
    <div class="label-with-info">
      <h2>Withdrawal Strategy</h2>
      <button
        class="info-btn"
        title="More information on strategies"
        onclick={() => showStrategyInfo = true}
        aria-label="More information on strategies"
      >ℹ</button>
    </div>
    <select bind:value={strategy}>
      <option value="constant-dollar">Constant dollar</option>
      <option value="percent-of-portfolio">Percent of portfolio</option>
      <option value="cape">CAPE (Shiller)</option>
      <option value="tobin">Tobin / Yale</option>
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
    {:else if strategy === 'percent-of-portfolio'}
      <label class="field">
        <span>Annual withdrawal</span>
        <div class="input-adorn">
          <input type="number" min="0" max="100" step="0.1" bind:value={withdrawalPct} />
          <span class="adorn-right">%</span>
        </div>
      </label>
    {:else if strategy === 'cape'}
      <label class="field">
        <span>Base rate</span>
        <div class="input-adorn">
          <input type="number" min="0" step="0.1" bind:value={capeBasePct} />
          <span class="adorn-right">%</span>
        </div>
      </label>
      <label class="field">
        <span>CAPE multiplier</span>
        <input type="number" min="0" step="0.1" bind:value={capeMultiplier} />
      </label>
      <p class="derived-hint">Rate = base + multiplier ÷ CAPE. E.g. at CAPE 25: {(capeBasePct + capeMultiplier / 25).toFixed(2)}%</p>
    {:else}
      <label class="field">
        <span>Prev-year weight</span>
        <div class="input-adorn">
          <input type="number" min="0" max="100" step="1" bind:value={tobinPrevYearPct} />
          <span class="adorn-right">%</span>
        </div>
      </label>
      {#if tobinPrevYearPct < 0 || tobinPrevYearPct > 100}
        <p class="error-msg">Prev-year weight must be between 0% and 100%.</p>
      {/if}
      <p class="derived-hint">Portfolio weight: {(100 - tobinPrevYearPct).toFixed(1)}%</p>
      <label class="field">
        <span>Spending rate</span>
        <div class="input-adorn">
          <input type="number" min="0" max="100" step="0.1" bind:value={tobinSpendingRate} />
          <span class="adorn-right">%</span>
        </div>
      </label>
      {#if tobinSpendingRate < 0 || tobinSpendingRate > 100}
        <p class="error-msg">Spending rate must be between 0% and 100%.</p>
      {/if}
      <label class="checkbox-label" style="margin-top: 0.25rem;">
        <input type="checkbox" bind:checked={tobinInflationAdjust} />
        Inflation-adjust previous year
      </label>
    {/if}

    {#if strategy === 'percent-of-portfolio'}
      <div class="bound-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={floorEnabled} /> Min withdrawal (floor)
        </label>
        {#if floorEnabled}
          <div class="input-adorn">
            <span class="adorn-left">$</span>
            <input type="number" min="0" step="1000" bind:value={pctFloorValue} />
          </div>
          <p class="bound-note">Inflation-adjusted — grows with CPI each year.</p>
        {/if}
      </div>
      <div class="bound-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={ceilEnabled} /> Max withdrawal (ceiling)
        </label>
        {#if ceilEnabled}
          <div class="input-adorn">
            <span class="adorn-left">$</span>
            <input type="number" min="0" step="1000" bind:value={pctCeilValue} />
          </div>
          <p class="bound-note">Inflation-adjusted — grows with CPI each year.</p>
        {/if}
      </div>
    {:else if strategy === 'cape'}
      <div class="bound-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={floorEnabled} /> Min withdrawal (floor)
        </label>
        {#if floorEnabled}
          <div class="radio-group sub-radio">
            <label><input type="radio" bind:group={floorType} value="pct" /> % of portfolio</label>
            <label><input type="radio" bind:group={floorType} value="dollar" /> $ (inflation-adj.)</label>
          </div>
          <div class="input-adorn">
            {#if floorType === 'dollar'}<span class="adorn-left">$</span>{/if}
            <input type="number" min="0" step={floorType === 'pct' ? 0.1 : 1000} bind:value={floorValue} />
            {#if floorType === 'pct'}<span class="adorn-right">%</span>{/if}
          </div>
        {/if}
      </div>
      <div class="bound-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={ceilEnabled} /> Max withdrawal (ceiling)
        </label>
        {#if ceilEnabled}
          <div class="radio-group sub-radio">
            <label><input type="radio" bind:group={ceilType} value="pct" /> % of portfolio</label>
            <label><input type="radio" bind:group={ceilType} value="dollar" /> $ (inflation-adj.)</label>
          </div>
          <div class="input-adorn">
            {#if ceilType === 'dollar'}<span class="adorn-left">$</span>{/if}
            <input type="number" min="0" step={ceilType === 'pct' ? 0.1 : 1000} bind:value={ceilValue} />
            {#if ceilType === 'pct'}<span class="adorn-right">%</span>{/if}
          </div>
        {/if}
      </div>
    {:else if strategy === 'tobin'}
      <div class="bound-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={tobinFloorEnabled} /> Min withdrawal (floor)
        </label>
        {#if tobinFloorEnabled}
          <div class="input-adorn">
            <span class="adorn-left">$</span>
            <input type="number" min="0" step="1000" bind:value={tobinFloorValue} />
          </div>
          <p class="bound-note">Inflation-adjusted — grows with CPI each year.</p>
        {/if}
      </div>
      <div class="bound-row">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={tobinCeilEnabled} /> Max withdrawal (ceiling)
        </label>
        {#if tobinCeilEnabled}
          <div class="input-adorn">
            <span class="adorn-left">$</span>
            <input type="number" min="0" step="1000" bind:value={tobinCeilValue} />
          </div>
          <p class="bound-note">Inflation-adjusted — grows with CPI each year.</p>
        {/if}
      </div>
    {/if}

    {#if boundsHardConflict}
      <p class="error-msg">
        {#if strategy === 'percent-of-portfolio'}
          Floor (${fmt(pctFloorValue)}) exceeds ceiling (${fmt(pctCeilValue)}) — adjust bounds before running.
        {:else if strategy === 'tobin'}
          Floor (${fmt(tobinFloorValue)}) exceeds ceiling (${fmt(tobinCeilValue)}) — adjust bounds before running.
        {:else}
          Floor ({floorType === 'pct' ? floorValue + '%' : '$' + fmt(floorValue)}) exceeds ceiling
          ({ceilType === 'pct' ? ceilValue + '%' : '$' + fmt(ceilValue)}) — adjust bounds before running.
        {/if}
      </p>
    {:else if boundsSoftConflict}
      <p class="warn-msg">
        Floor (${fmt(floorDollarAtStart)}) exceeds ceiling (${fmt(ceilDollarAtStart)}) at current
        portfolio value — floor will take priority each year.
      </p>
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

  <section class="card">
    <h2>Date Filter</h2>
    <label class="field">
      <span>First year</span>
      <input type="number" min="1800" max="2100" placeholder="—" bind:value={startYearMin} />
    </label>
    <label class="field">
      <span>Last year</span>
      <input type="number" min="1800" max="2100" placeholder="—" bind:value={startYearMax} />
    </label>
    {#if yearFilterInvalid}
      <p class="error-msg">First year must not exceed last year.</p>
    {/if}
  </section>

  <button class="run-btn" onclick={handleRun} disabled={!isValid}>
    Run Simulation
  </button>

  {#if dirty}
    <p class="stale-msg">Run Simulation to refresh results.</p>
  {/if}

</aside>

{#if showStrategyInfo}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="overlay-backdrop" onclick={() => showStrategyInfo = false} role="presentation"></div>
  <div class="overlay-box" role="dialog" aria-modal="true" aria-label="Withdrawal strategies">
    <button class="overlay-close" onclick={() => showStrategyInfo = false} aria-label="Close">✕</button>
    <div class="overlay-content">
      <h2 class="overlay-title">Withdrawal Strategies</h2>

      <div class="strategy-card">
        <h3>Constant Dollar</h3>
        <p>The classic "4% rule" approach. Set a fixed annual withdrawal at retirement; it grows with inflation each year to preserve purchasing power.</p>
        <div class="pros-cons">
          <div class="pros-col">
            <p class="pros-header">Pros</p>
            <ul>
              <li>Predictable income each year</li>
              <li>Simple to understand</li>
              <li>Purchasing power preserved</li>
            </ul>
          </div>
          <div class="cons-col">
            <p class="cons-header">Cons</p>
            <ul>
              <li>No adjustment for portfolio performance</li>
              <li>Risk of depletion after a poor-return sequence</li>
              <li>May leave large unspent amounts in strong markets</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="strategy-card">
        <h3>Percent of Portfolio</h3>
        <p>Withdraw a fixed percentage of your current portfolio each year. Income rises in bull markets and falls in downturns.</p>
        <div class="pros-cons">
          <div class="pros-col">
            <p class="pros-header">Pros</p>
            <ul>
              <li>Portfolio can never be technically depleted</li>
              <li>Automatically reduces spending in downturns</li>
              <li>Grows with the portfolio</li>
            </ul>
          </div>
          <div class="cons-col">
            <p class="cons-header">Cons</p>
            <ul>
              <li>Highly variable year-to-year income</li>
              <li>Can drop sharply in a crash, making budgeting difficult</li>
              <li>Without bounds, no income floor</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="strategy-card">
        <h3>CAPE / Shiller</h3>
        <p>Sets the annual withdrawal rate based on market valuation (Shiller P/E 10): <em>Rate = Base + Multiplier ÷ CAPE</em>. Spend less when markets are expensive, more when they are cheap.</p>
        <div class="pros-cons">
          <div class="pros-col">
            <p class="pros-header">Pros</p>
            <ul>
              <li>Valuation-aware — naturally reduces withdrawals in overvalued markets</li>
              <li>Historically extends portfolio longevity</li>
              <li>Optional bounds for stability</li>
            </ul>
          </div>
          <div class="cons-col">
            <p class="cons-header">Cons</p>
            <ul>
              <li>Variable year-to-year income, although potentially more stable than Percent of Portfolio</li>
              <li>Formula less intuitive than other strategies</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="strategy-card">
        <h3>Tobin / Yale Endowment</h3>
        <p>A smoothing rule from institutional endowment management. Each year blends a share of last year's withdrawal with a portfolio-based spending target: <em>W = α × W<sub>prev</sub> + (1 − α) × rate × portfolio</em>.</p>
        <div class="pros-cons">
          <div class="pros-col">
            <p class="pros-header">Pros</p>
            <ul>
              <li>Smooth, gradual income changes</li>
              <li>Balances stability and portfolio-sensitivity</li>
              <li>Optional inflation adjustment preserves real purchasing power of the prior-year component</li>
            </ul>
          </div>
          <div class="cons-col">
            <p class="cons-header">Cons</p>
            <ul>
              <li>Slow to respond to a large portfolio decline</li>
              <li>Prior-year inertia can sustain high spending through a crash</li>
              <li>More parameters to configure</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

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
    font-size: 0.75rem;
    color: #ef4444;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 4px;
    padding: 0.5rem 0.625rem;
  }

  .warn-msg {
    margin: 0;
    font-size: 0.75rem;
    color: #92400e;
    background: #fffbeb;
    border: 1px solid #fcd34d;
    border-radius: 4px;
    padding: 0.5rem 0.625rem;
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

  .bound-row {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.5rem;
  }

  .bound-note {
    margin: 0;
    font-size: 0.7rem;
    color: #9ca3af;
    font-style: italic;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #374151;
    cursor: pointer;
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

  /* ---- strategy label + info icon ---- */
  .label-with-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .info-btn {
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    border: 1px solid #d1d5db;
    background: #f9fafb;
    cursor: pointer;
    color: #9ca3af;
    font-size: 0.65rem;
    font-style: italic;
    font-weight: 700;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
  }
  .info-btn:hover {
    background: #e5e7eb;
    color: #374151;
    border-color: #9ca3af;
  }

  /* ---- overlay ---- */
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 100;
  }
  .overlay-box {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 92vw);
    max-height: 80vh;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    z-index: 101;
    display: flex;
    flex-direction: column;
  }
  .overlay-close {
    position: sticky;
    top: 0;
    align-self: flex-end;
    margin: 0.75rem 0.75rem 0 0;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.1rem;
    color: #6b7280;
    z-index: 1;
    flex-shrink: 0;
  }
  .overlay-close:hover { color: #111; }
  .overlay-content {
    overflow-y: auto;
    padding: 0 1.25rem 1.25rem;
  }
  .overlay-title {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
    margin: 0 0 0.75rem;
    text-transform: none;
    letter-spacing: normal;
  }

  /* ---- strategy cards in overlay ---- */
  .strategy-card        { margin-bottom: 1.75rem; }
  .strategy-card h3     { margin: 0 0 0.4rem; font-size: 0.9rem; font-weight: 600; color: #111827; }
  .strategy-card > p    { font-size: 0.82rem; color: #374151; line-height: 1.5; margin: 0 0 0.75rem; }
  .pros-cons            { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .pros-header          { color: #009E73; margin: 0 0 0.3rem; font-size: 0.75rem; font-weight: 700; }
  .cons-header          { color: #CC3311; margin: 0 0 0.3rem; font-size: 0.75rem; font-weight: 700; }
  .pros-col ul,
  .cons-col ul          { margin: 0; padding-left: 1rem; }
  .pros-col li,
  .cons-col li          { font-size: 0.78rem; color: #374151; line-height: 1.45; margin-bottom: 0.2rem; }

  @media (max-width: 768px) {
    .input-panel {
      width: 100%;
      height: auto;
      overflow-y: visible;
      border-right: none;
      border-bottom: 1px solid #e5e7eb;
    }
    .pros-cons { grid-template-columns: 1fr; }
  }
</style>
