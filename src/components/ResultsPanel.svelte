<script lang="ts">
  import Plotly from 'plotly.js-dist-min';
  import type { AggregatedResults, PercentileStats, SimulationResult } from '../engine/types';
  import SimulationList from './SimulationList.svelte';
  import SimulationDetail from './SimulationDetail.svelte';

  interface Props {
    results: AggregatedResults;
  }
  let { results }: Props = $props();

  let selectedSim    = $state<SimulationResult | null>(null);
  let savedScrollTop = 0;

  // On desktop, .results-area scrolls independently. On mobile it has overflow-y: visible
  // so the window scrolls instead. Detect which is active by checking scrollability.
  function resultsAreaScrollable(): boolean {
    const el = document.querySelector('.results-area') as HTMLElement | null;
    return !!el && el.scrollHeight > el.clientHeight + 1;
  }

  function saveScroll() {
    savedScrollTop = resultsAreaScrollable()
      ? (document.querySelector('.results-area') as HTMLElement).scrollTop
      : window.scrollY;
  }

  function restoreScroll(top: number) {
    if (resultsAreaScrollable()) {
      (document.querySelector('.results-area') as HTMLElement).scrollTop = top;
    } else {
      window.scrollTo({ top, behavior: 'instant' });
    }
  }

  function handleSelectSim(sim: SimulationResult) {
    saveScroll();
    selectedSim = sim;
  }

  // Reset detail view and saved position whenever results are replaced (new run)
  $effect(() => {
    void results.simulationCount;
    savedScrollTop = 0;
    selectedSim = null;
  });

  function scrollToResultsTop() {
    if (resultsAreaScrollable()) {
      (document.querySelector('.results-area') as HTMLElement).scrollTop = 0;
    } else {
      // On mobile the window scrolls — jump to the top of .results-area, not the page top,
      // since InputPanel sits above it.
      const el = document.querySelector('.results-area') as HTMLElement | null;
      window.scrollTo({ top: el?.offsetTop ?? 0, behavior: 'instant' });
    }
  }

  // Scroll to top of results when entering detail; restore position when returning
  $effect(() => {
    if (selectedSim !== null) {
      scrollToResultsTop();
    } else {
      restoreScroll(savedScrollTop);
    }
  });

  type PortfolioView = 'nominal' | 'real' | 'pct';
  type WithdrawalView = 'nominal' | 'real';
  type DrawdownView = 'nominal' | 'real';

  let portfolioView  = $state<PortfolioView>('nominal');
  let withdrawalView = $state<WithdrawalView>('nominal');
  let drawdownView   = $state<DrawdownView>('nominal');

  // ---- stats helper (mirrors engine, kept local to avoid coupling) ----
  function computeStats(values: number[]): PercentileStats {
    if (values.length === 0) {
      return { min: 0, p5: 0, p25: 0, median: 0, p75: 0, p95: 0, max: 0, mean: 0 };
    }
    const s = [...values].sort((a, b) => a - b);
    const p = (pct: number) => {
      const i = (pct / 100) * (s.length - 1);
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      return s[lo] + (i - lo) * (s[hi] - s[lo]);
    };
    return {
      min:    s[0],
      p5:     p(5),
      p25:    p(25),
      median: p(50),
      p75:    p(75),
      p95:    p(95),
      max:    s[s.length - 1],
      mean:   values.reduce((a, v) => a + v, 0) / values.length,
    };
  }

  // ---- formatters ----
  const fmtDollar = (n: number) =>
    (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

  const fmtSufficiency = (n: number) => n.toFixed(1) + '%';

  // ---- derived data ----
  let portfolioData = $derived(
    portfolioView === 'nominal' ? results.finalPortfoliosNominal :
    portfolioView === 'real'    ? results.finalPortfoliosReal :
    results.finalPortfoliosPctOfInitial.map(v => v * 100)
  );
  let portfolioStats = $derived(computeStats(portfolioData));
  let portfolioFmt = $derived(
    portfolioView === 'pct'
      ? (n: number) => n.toFixed(1) + '%'
      : fmtDollar
  );

  let withdrawalData  = $derived(
    withdrawalView === 'nominal' ? results.withdrawalsNominal : results.withdrawalsReal
  );
  let withdrawalStats = $derived(computeStats(withdrawalData));

  // Sufficiency values are ratios; multiply by 100 for display
  let suffData  = $derived(results.sufficiencies.map(v => v * 100));
  let suffStats = $derived(computeStats(suffData));

  // Drawdown values are fractions; multiply by 100 for display (will be ≤ 0)
  let drawdownData  = $derived(
    (drawdownView === 'nominal' ? results.maxDrawdownsNominal : results.maxDrawdownsReal)
      .map(v => v * 100)
  );
  let drawdownStats = $derived(computeStats(drawdownData));

  let successColor = $derived(
    results.successRate >= 0.9 ? '#10b981' :
    results.successRate >= 0.7 ? '#f59e0b' :
    '#ef4444'
  );

  // ---- Plotly chart refs ----
  let portfolioChartEl:  HTMLDivElement | undefined = $state();
  let withdrawalChartEl: HTMLDivElement | undefined = $state();
  let suffChartEl:       HTMLDivElement | undefined = $state();
  let drawdownChartEl:   HTMLDivElement | undefined = $state();

  const chartConfig = { responsive: true, displayModeBar: false };

  // Pre-bin data for bar charts so tooltips can show the x-range of each bar.
  // Returns bin midpoints, human-readable labels, counts, and a nice bin size.
  function preBin(
    data: number[],
    fmtLabel: (lo: number, hi: number) => string,
    targetBins = 25,
  ): { mids: number[]; labels: string[]; counts: number[]; size: number } {
    const n = data.length;
    if (n === 0) return { mids: [], labels: [], counts: [], size: 1 };
    let lo = Infinity, hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const range = hi - lo;
    let size: number;
    if (range === 0) {
      size = 1;
    } else {
      const raw = range / targetBins;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      size = norm <= 1.5 ? mag : norm <= 3 ? 2 * mag : norm <= 7 ? 5 * mag : 10 * mag;
    }
    const start = Math.floor(lo / size) * size;
    const nBins  = Math.ceil((hi - start) / size) + 1;
    const counts = new Array(nBins).fill(0);
    for (const v of data) {
      const idx = Math.min(Math.floor((v - start) / size), nBins - 1);
      if (idx >= 0) counts[idx]++;
    }
    const mids   = Array.from({ length: nBins }, (_, i) => start + i * size + size / 2);
    const labels = Array.from({ length: nBins }, (_, i) =>
      fmtLabel(start + i * size, start + (i + 1) * size)
    );
    return { mids, labels, counts, size };
  }

  function makeLayout(yTitle: string) {
    return {
      height: 300,
      margin: { t: 10, r: 20, b: 50, l: 70 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: '#f9fafb',
      bargap: 0.02,
      font: { family: 'system-ui, -apple-system, sans-serif', size: 11, color: '#6b7280' },
      yaxis: { title: { text: yTitle } },
    };
  }

  $effect(() => {
    if (!portfolioChartEl) return;
    const isMonetary = portfolioView !== 'pct';
    const fmtLabel = isMonetary
      ? (lo: number, hi: number) => `$${Math.round(lo).toLocaleString('en-US')}–$${Math.round(hi).toLocaleString('en-US')}`
      : (lo: number, hi: number) => `${lo.toFixed(0)}%–${hi.toFixed(0)}%`;
    const { mids, labels, counts, size } = preBin(portfolioData, fmtLabel);
    Plotly.react(
      portfolioChartEl,
      [{
        type: 'bar', x: mids, y: counts, width: size * 0.96,
        customdata: labels,
        marker: { color: '#3b82f6', opacity: 0.85 },
        hovertemplate: '%{customdata}<br>Count: %{y}<extra></extra>',
      }],
      {
        ...makeLayout('Simulations'),
        xaxis: {
          tickprefix: isMonetary ? '$' : '',
          tickformat: isMonetary ? ',.0f' : '.1f',
          ticksuffix: portfolioView === 'pct' ? '%' : '',
        },
      },
      chartConfig,
    );
  });

  $effect(() => {
    if (!withdrawalChartEl) return;
    const fmtLabel = (lo: number, hi: number) =>
      `$${Math.round(lo).toLocaleString('en-US')}–$${Math.round(hi).toLocaleString('en-US')}`;
    const { mids, labels, counts, size } = preBin(withdrawalData, fmtLabel);
    Plotly.react(
      withdrawalChartEl,
      [{
        type: 'bar', x: mids, y: counts, width: size * 0.96,
        customdata: labels,
        marker: { color: '#3b82f6', opacity: 0.85 },
        hovertemplate: '%{customdata}<br>Count: %{y}<extra></extra>',
      }],
      { ...makeLayout('Frequency'), xaxis: { tickprefix: '$', tickformat: ',.0f' } },
      chartConfig,
    );
  });

  $effect(() => {
    if (!suffChartEl) return;
    const fmtLabel = (lo: number, hi: number) => `${lo.toFixed(0)}%–${hi.toFixed(0)}%`;
    const { mids, labels, counts, size } = preBin(suffData, fmtLabel);
    Plotly.react(
      suffChartEl,
      [{
        type: 'bar', x: mids, y: counts, width: size * 0.96,
        customdata: labels,
        marker: { color: '#3b82f6', opacity: 0.85 },
        hovertemplate: '%{customdata}<br>Count: %{y}<extra></extra>',
      }],
      { ...makeLayout('Frequency'), xaxis: { tickformat: '.0f', ticksuffix: '%' } },
      chartConfig,
    );
  });

  $effect(() => {
    if (!drawdownChartEl) return;
    const total = drawdownData.length;
    const BIN_SIZE = 5;
    const BIN_COUNT = 21; // 0–5, 5–10, … 100–105
    const counts = new Array(BIN_COUNT).fill(0);
    for (const v of drawdownData) {
      const idx = Math.min(Math.floor(v / BIN_SIZE), BIN_COUNT - 1);
      if (idx >= 0) counts[idx]++;
    }
    const binMids   = Array.from({ length: BIN_COUNT }, (_, i) => i * BIN_SIZE + BIN_SIZE / 2);
    const binLabels = Array.from({ length: BIN_COUNT }, (_, i) =>
      `${i * BIN_SIZE}%–${(i + 1) * BIN_SIZE}%`
    );
    const pcts = counts.map(c => total > 0 ? (c / total) * 100 : 0);
    Plotly.react(
      drawdownChartEl,
      [{
        type: 'bar',
        x: binMids,
        y: pcts,
        width: BIN_SIZE * 0.96,
        customdata: counts.map((c, i) => [c, binLabels[i]]),
        marker: { color: '#3b82f6', opacity: 0.85 },
        hovertemplate: '%{customdata[1]}<br>%{customdata[0]} simulations (%{y:.1f}%)<extra></extra>',
      }],
      {
        ...makeLayout('% of Simulations'),
        xaxis: { tickformat: '.0f', ticksuffix: '%', dtick: 10 },
      },
      chartConfig,
    );
  });
</script>

{#if selectedSim}
  <SimulationDetail sim={selectedSim} onback={() => { selectedSim = null; }} />
{:else}
<div class="results-panel">

  <!-- Overview -->
  <div class="card overview">
    <div class="overview-stats">
      <div class="stat-block">
        <span class="stat-label">Simulations</span>
        <span class="stat-value">{results.simulationCount}</span>
        <span class="stat-sub">{results.dataStartYear}–{results.dataEndYear} data range</span>
      </div>
      <div class="stat-block">
        <span class="stat-label">Success rate</span>
        <span class="stat-value" style:color={successColor}>
          {(results.successRate * 100).toFixed(1)}%
        </span>
        <span class="stat-sub">{results.successCount} of {results.simulationCount} never depleted</span>
      </div>
    </div>
    {#if results.simulationCount < 20}
      <p class="low-count-warning">
        Only {results.simulationCount} simulations — results may not be statistically representative.
        Consider a shorter duration or a dataset with a longer history.
      </p>
    {/if}
  </div>

  <!-- Final Portfolio Value -->
  <div class="card">
    <div class="section-header">
      <h2>Final Portfolio Value</h2>
      <div class="toggle-group">
        <button class:active={portfolioView === 'nominal'} onclick={() => portfolioView = 'nominal'}>Nominal</button>
        <button class:active={portfolioView === 'real'}    onclick={() => portfolioView = 'real'}>Real</button>
        <button class:active={portfolioView === 'pct'}     onclick={() => portfolioView = 'pct'}>% of Initial</button>
      </div>
    </div>
    {#if portfolioView === 'real'}
      <p class="view-note">Values in start-year dollars (each simulation deflated to its own base year).</p>
    {/if}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Min</th><th>P5</th><th>P25</th><th>Median</th><th>P75</th><th>P95</th><th>Max</th><th>Mean</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{portfolioFmt(portfolioStats.min)}</td>
            <td>{portfolioFmt(portfolioStats.p5)}</td>
            <td>{portfolioFmt(portfolioStats.p25)}</td>
            <td class="em">{portfolioFmt(portfolioStats.median)}</td>
            <td>{portfolioFmt(portfolioStats.p75)}</td>
            <td>{portfolioFmt(portfolioStats.p95)}</td>
            <td>{portfolioFmt(portfolioStats.max)}</td>
            <td>{portfolioFmt(portfolioStats.mean)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div bind:this={portfolioChartEl} class="chart"></div>
  </div>

  <!-- Annual Withdrawals -->
  <div class="card">
    <div class="section-header">
      <h2>Annual Withdrawals</h2>
      <div class="toggle-group">
        <button class:active={withdrawalView === 'nominal'} onclick={() => withdrawalView = 'nominal'}>Nominal</button>
        <button class:active={withdrawalView === 'real'}    onclick={() => withdrawalView = 'real'}>Real</button>
      </div>
    </div>
    {#if withdrawalView === 'real'}
      <p class="view-note">Values in start-year dollars (each simulation deflated to its own base year).</p>
    {/if}
    <p class="view-note">Flat pool across all simulations × years. Includes $0 values from depleted portfolios.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Min</th><th>P5</th><th>P25</th><th>Median</th><th>P75</th><th>P95</th><th>Max</th><th>Mean</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{fmtDollar(withdrawalStats.min)}</td>
            <td>{fmtDollar(withdrawalStats.p5)}</td>
            <td>{fmtDollar(withdrawalStats.p25)}</td>
            <td class="em">{fmtDollar(withdrawalStats.median)}</td>
            <td>{fmtDollar(withdrawalStats.p75)}</td>
            <td>{fmtDollar(withdrawalStats.p95)}</td>
            <td>{fmtDollar(withdrawalStats.max)}</td>
            <td>{fmtDollar(withdrawalStats.mean)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div bind:this={withdrawalChartEl} class="chart"></div>
  </div>

  <!-- Withdrawal Sufficiency -->
  <div class="card">
    <div class="section-header">
      <h2>Withdrawal Sufficiency</h2>
    </div>
    <p class="view-note">
      The target each year is the initial withdrawal amount adjusted for inflation.
      Flat pool across all simulations × years.<br />
      100% = exactly met target withdrawal. 0% = nothing withdrawn (portfolio depleted). 200% = double the target.
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Min</th><th>P5</th><th>P25</th><th>Median</th><th>P75</th><th>P95</th><th>Max</th><th>Mean</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{fmtSufficiency(suffStats.min)}</td>
            <td>{fmtSufficiency(suffStats.p5)}</td>
            <td>{fmtSufficiency(suffStats.p25)}</td>
            <td class="em">{fmtSufficiency(suffStats.median)}</td>
            <td>{fmtSufficiency(suffStats.p75)}</td>
            <td>{fmtSufficiency(suffStats.p95)}</td>
            <td>{fmtSufficiency(suffStats.max)}</td>
            <td>{fmtSufficiency(suffStats.mean)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div bind:this={suffChartEl} class="chart"></div>
  </div>

  <!-- Withdrawal Max Drawdown -->
  <div class="card">
    <div class="section-header">
      <h2>Withdrawal Max Drawdown</h2>
      <div class="toggle-group">
        <button class:active={drawdownView === 'nominal'} onclick={() => drawdownView = 'nominal'}>Nominal</button>
        <button class:active={drawdownView === 'real'}    onclick={() => drawdownView = 'real'}>Real</button>
      </div>
    </div>
    <p class="view-note">
      Largest % drop in annual withdrawal from its running peak, one value per simulation.
      0% = withdrawal never declined. 100% = portfolio depleted (withdrew $0).
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Min</th><th>P5</th><th>P25</th><th>Median</th><th>P75</th><th>P95</th><th>Max</th><th>Mean</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{drawdownStats.min.toFixed(1)}%</td>
            <td>{drawdownStats.p5.toFixed(1)}%</td>
            <td>{drawdownStats.p25.toFixed(1)}%</td>
            <td class="em">{drawdownStats.median.toFixed(1)}%</td>
            <td>{drawdownStats.p75.toFixed(1)}%</td>
            <td>{drawdownStats.p95.toFixed(1)}%</td>
            <td>{drawdownStats.max.toFixed(1)}%</td>
            <td>{drawdownStats.mean.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div bind:this={drawdownChartEl} class="chart"></div>
  </div>

  <!-- Simulation list -->
  <SimulationList {results} onselect={handleSelectSim} />

</div>
{/if}

<style>
  .results-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
  }

  /* ---- cards ---- */
  .card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* ---- overview ---- */
  .overview-stats {
    display: flex;
    gap: 3rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .stat-block {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .stat-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9ca3af;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: #111827;
    line-height: 1.1;
  }

  .stat-sub {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .low-count-warning {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #fffbeb;
    border: 1px solid #fcd34d;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #92400e;
  }

  /* ---- section header ---- */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  h2 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #111827;
    margin: 0;
  }

  /* ---- toggle ---- */
  .toggle-group {
    display: flex;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    overflow: hidden;
  }

  .toggle-group button {
    padding: 0.25rem 0.625rem;
    background: white;
    border: none;
    border-right: 1px solid #d1d5db;
    font-size: 0.75rem;
    cursor: pointer;
    color: #374151;
    transition: background 0.1s;
  }

  .toggle-group button:last-child { border-right: none; }

  .toggle-group button.active {
    background: #3b82f6;
    color: white;
  }

  .toggle-group button:hover:not(.active) {
    background: #f3f4f6;
  }

  /* ---- notes ---- */
  .view-note {
    margin: 0;
    font-size: 0.75rem;
    color: #9ca3af;
    font-style: italic;
  }

  /* ---- stats table ---- */
  .table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    min-width: 520px;
  }

  th {
    text-align: right;
    font-weight: 600;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
    padding: 0.25rem 0.625rem;
    border-bottom: 1px solid #f3f4f6;
  }

  td {
    text-align: right;
    padding: 0.375rem 0.625rem;
    color: #374151;
    white-space: nowrap;
  }

  td.em {
    font-weight: 700;
    color: #111827;
  }

  /* ---- chart ---- */
  .chart { width: 100%; min-height: 300px; }

  @media (max-width: 768px) {
    .results-panel {
      padding: 1rem;
    }
    .overview-stats {
      gap: 1.5rem;
    }
  }
</style>
