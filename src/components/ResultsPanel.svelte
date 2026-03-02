<script lang="ts">
  import Plotly from 'plotly.js-dist-min';
  import type { AggregatedResults, PercentileStats, SimulationResult } from '../engine/types';
  import SimulationList from './SimulationList.svelte';
  import SimulationDetail from './SimulationDetail.svelte';

  interface Props {
    results: AggregatedResults;
  }
  let { results }: Props = $props();

  let selectedSim = $state<SimulationResult | null>(null);

  // Reset detail view whenever results are replaced (new run)
  $effect(() => {
    void results.simulationCount;
    selectedSim = null;
  });

  type PortfolioView = 'nominal' | 'real' | 'pct';
  type WithdrawalView = 'nominal' | 'real';

  let portfolioView  = $state<PortfolioView>('nominal');
  let withdrawalView = $state<WithdrawalView>('nominal');

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

  let successColor = $derived(
    results.successRate >= 0.9 ? '#10b981' :
    results.successRate >= 0.7 ? '#f59e0b' :
    '#ef4444'
  );

  // ---- Plotly chart refs ----
  let portfolioChartEl:  HTMLDivElement | undefined = $state();
  let withdrawalChartEl: HTMLDivElement | undefined = $state();
  let suffChartEl:       HTMLDivElement | undefined = $state();

  const chartConfig = { responsive: true, displayModeBar: false };

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
    const hovertemplate = isMonetary
      ? '$%{x:,.0f}<br>Count: %{y}<extra></extra>'
      : '%{x:.1f}%<br>Count: %{y}<extra></extra>';
    Plotly.react(
      portfolioChartEl,
      [{ type: 'histogram', x: portfolioData, marker: { color: '#3b82f6', opacity: 0.85 }, hovertemplate }],
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
    Plotly.react(
      withdrawalChartEl,
      [{ type: 'histogram', x: withdrawalData, marker: { color: '#3b82f6', opacity: 0.85 },
         hovertemplate: '$%{x:,.0f}<br>Count: %{y}<extra></extra>' }],
      { ...makeLayout('Frequency'), xaxis: { tickprefix: '$', tickformat: ',.0f' } },
      chartConfig,
    );
  });

  $effect(() => {
    if (!suffChartEl) return;
    Plotly.react(
      suffChartEl,
      [{ type: 'histogram', x: suffData, marker: { color: '#3b82f6', opacity: 0.85 },
         hovertemplate: '%{x:.1f}%<br>Count: %{y}<extra></extra>' }],
      { ...makeLayout('Frequency'), xaxis: { tickformat: '.0f', ticksuffix: '%' } },
      chartConfig,
    );
  });
</script>

{#if selectedSim}
  <SimulationDetail sim={selectedSim} onback={() => (selectedSim = null)} />
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
      100% = exactly met target withdrawal. 0% = nothing withdrawn (portfolio depleted). 200% = double the target.
      Flat pool across all simulations × years.
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

  <!-- Simulation list -->
  <SimulationList {results} onselect={(s) => (selectedSim = s)} />

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
</style>
