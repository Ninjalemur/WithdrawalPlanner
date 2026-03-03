<script lang="ts">
  import Plotly from 'plotly.js-dist-min';
  import type { SimulationResult } from '../engine/types';

  interface Props {
    sim: SimulationResult;
    onback: () => void;
  }
  let { sim, onback }: Props = $props();

  type MoneyView = 'nominal' | 'real';
  let wView = $state<MoneyView>('nominal');
  let hView = $state<MoneyView>('nominal');

  let allocEl:      HTMLDivElement | undefined = $state();
  let portfolioEl:  HTMLDivElement | undefined = $state();
  let withdrawalEl: HTMLDivElement | undefined = $state();
  let histEl:       HTMLDivElement | undefined = $state();

  const plotConfig = { responsive: true, displayModeBar: false };
  const xs = sim.years.map(y => y.calendarYear);

  function baseLayout(yTitle: string, marginTop = 10) {
    return {
      height: 280,
      margin: { t: marginTop, r: 20, b: 50, l: 80 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: '#f9fafb',
      font: { family: 'system-ui, -apple-system, sans-serif', size: 11, color: '#6b7280' },
      yaxis: { title: { text: yTitle } },
      xaxis: { tickformat: 'd' },
    };
  }

  // Allocation chart — only rendered for glidepath simulations
  const ALLOC_COLORS: Record<string, string> = {
    sp500: '#3b82f6',
    tbond: '#f59e0b',
    gold:  '#10b981',
  };
  const ALLOC_LABELS: Record<string, string> = {
    sp500: 'S&P 500',
    tbond: 'US T-Bond',
    gold:  'Gold',
  };

  const assetIds = sim.allocationMode === 'glidepath' && sim.years.length > 0
    ? sim.years[0].allocations.map(a => a.id)
    : [];

  $effect(() => {
    if (!allocEl || sim.allocationMode !== 'glidepath') return;
    const traces = assetIds.map(id => ({
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: ALLOC_LABELS[id] ?? id,
      x: xs,
      y: sim.years.map(y => y.allocations.find(a => a.id === id)?.pct ?? 0),
      line: { color: ALLOC_COLORS[id] ?? '#6b7280' },
      hovertemplate: `%{x}<br>${ALLOC_LABELS[id] ?? id}: %{y:.1f}%<extra></extra>`,
    }));
    Plotly.react(
      allocEl,
      traces,
      {
        ...baseLayout('Allocation (%)', 40),
        yaxis: { range: [0, 100], title: { text: 'Allocation (%)' } },
        showlegend: true,
        legend: { orientation: 'h' as const, x: 0.5, xanchor: 'center' as const, y: 1.18 },
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!portfolioEl) return;
    Plotly.react(
      portfolioEl,
      [
        {
          type: 'scatter', mode: 'markers', name: 'Initial',
          x: [sim.startYear - 1], y: [sim.initialPortfolio],
          marker: { color: '#9ca3af', size: 9, symbol: 'diamond' },
          hovertemplate: 'Initial<br>$%{y:,.0f}<extra></extra>',
        },
        {
          type: 'scatter', mode: 'lines+markers', name: 'Portfolio',
          x: xs, y: sim.years.map(y => y.portfolioAfter),
          line: { color: '#3b82f6' }, marker: { size: 4 },
          hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>',
        },
      ],
      { ...baseLayout('Portfolio Value ($)'), showlegend: false },
      plotConfig,
    );
  });

  $effect(() => {
    if (!withdrawalEl) return;
    const real = wView === 'real';
    const wY = sim.years.map(y => real ? y.withdrawn      / y.cumulativeInflationFactor : y.withdrawn);
    const dY = sim.years.map(y => real ? y.desiredExpense / y.cumulativeInflationFactor : y.desiredExpense);
    Plotly.react(
      withdrawalEl,
      [
        {
          type: 'scatter', mode: 'lines+markers', name: 'Withdrawn',
          x: xs, y: wY, line: { color: '#3b82f6' }, marker: { size: 4 },
          hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>',
        },
        {
          type: 'scatter', mode: 'lines', name: 'Desired',
          x: xs, y: dY, line: { color: '#f59e0b', dash: 'dash' },
          hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>',
        },
      ],
      {
        ...baseLayout(real ? 'Amount (start-yr $)' : 'Amount ($)', 40),
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.18 },
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!histEl) return;
    const real = hView === 'real';
    const data = sim.years.map(y => real ? y.withdrawn / y.cumulativeInflationFactor : y.withdrawn);
    Plotly.react(
      histEl,
      [{ type: 'histogram', x: data, marker: { color: '#3b82f6', opacity: 0.85 },
         hovertemplate: '$%{x:,.0f}<br>Count: %{y}<extra></extra>' }],
      { ...baseLayout('Years'), xaxis: { tickprefix: '$', tickformat: ',.0f' } },
      plotConfig,
    );
  });

  const fmtD = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%';
  const fmtFactor = (f: number) => ((f - 1) * 100).toFixed(1) + '%';
</script>

<div class="detail-panel">

  <!-- Header -->
  <div class="detail-header">
    <button class="back-btn" onclick={onback}>← Back to Results</button>
    <div class="header-title">
      <h1>{sim.startYear}–{sim.endYear}</h1>
      <span class="badge" class:survived={!sim.failed} class:failed={sim.failed}>
        {sim.failed ? '✗ Depleted' : '✓ Survived'}
      </span>
    </div>
    <div class="header-stats">
      <div class="hstat">
        <span class="hstat-label">Initial</span>
        <span class="hstat-val">{fmtD(sim.initialPortfolio)}</span>
      </div>
      <div class="hstat">
        <span class="hstat-label">Final (nominal)</span>
        <span class="hstat-val">{fmtD(sim.finalPortfolioNominal)}</span>
      </div>
      <div class="hstat">
        <span class="hstat-label">Final (real)</span>
        <span class="hstat-val">{fmtD(sim.finalPortfolioReal)}</span>
      </div>
      <div class="hstat">
        <span class="hstat-label">Duration</span>
        <span class="hstat-val">{sim.years.length} yrs</span>
      </div>
    </div>
  </div>

  <!-- Portfolio Over Time -->
  <div class="card">
    <h2>Portfolio Value Over Time</h2>
    <p class="view-note">Diamond = initial value before simulation. Line = end-of-year portfolio after withdrawal.</p>
    <div bind:this={portfolioEl} class="chart"></div>
  </div>

  <!-- Allocation Over Time (glidepath only) -->
  {#if sim.allocationMode === 'glidepath'}
    <div class="card">
      <h2>Asset Allocation Over Time</h2>
      <p class="view-note">Target allocation used for rebalancing each year.</p>
      <div bind:this={allocEl} class="chart"></div>
    </div>
  {/if}

  <!-- Withdrawals Over Time -->
  <div class="card">
    <div class="section-header">
      <h2>Withdrawals Over Time</h2>
      <div class="toggle-group">
        <button class:active={wView === 'nominal'} onclick={() => wView = 'nominal'}>Nominal</button>
        <button class:active={wView === 'real'}    onclick={() => wView = 'real'}>Real</button>
      </div>
    </div>
    {#if wView === 'real'}
      <p class="view-note">In start-year dollars (divided by cumulative inflation factor).</p>
    {/if}
    <div bind:this={withdrawalEl} class="chart"></div>
  </div>

  <!-- Withdrawal Histogram -->
  <div class="card">
    <div class="section-header">
      <h2>Withdrawal Distribution</h2>
      <div class="toggle-group">
        <button class:active={hView === 'nominal'} onclick={() => hView = 'nominal'}>Nominal</button>
        <button class:active={hView === 'real'}    onclick={() => hView = 'real'}>Real</button>
      </div>
    </div>
    <div bind:this={histEl} class="chart"></div>
  </div>

  <!-- Year-by-Year Table -->
  <div class="card">
    <h2>Year-by-Year Data</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Year</th>
            <th>Portfolio Before</th>
            <th>Desired Expense</th>
            <th>Withdrawn</th>
            <th>Sufficiency</th>
            <th>Portfolio After</th>
            <th>Cum. Inflation</th>
            {#if sim.allocationMode === 'glidepath'}
              <th>Allocation</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sim.years as y}
            <tr class:depleted-row={y.portfolioAfter === 0 && y.withdrawn < y.desiredExpense}>
              <td>{y.calendarYear}</td>
              <td>{fmtD(y.portfolioBeforeWithdrawal)}</td>
              <td>{fmtD(y.desiredExpense)}</td>
              <td>{fmtD(y.withdrawn)}</td>
              <td class:suff-ok={y.sufficiency >= 1} class:suff-low={y.sufficiency < 1}>{fmtPct(y.sufficiency)}</td>
              <td>{fmtD(y.portfolioAfter)}</td>
              <td>{fmtFactor(y.cumulativeInflationFactor)}</td>
              {#if sim.allocationMode === 'glidepath'}
                <td class="alloc-cell">
                  {y.allocations.map(a => `${(ALLOC_LABELS[a.id] ?? a.id)}: ${a.pct.toFixed(1)}%`).join(' / ')}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

</div>

<style>
  .detail-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.5rem;
  }

  /* ---- header ---- */
  .detail-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .back-btn {
    align-self: flex-start;
    padding: 0.375rem 0.75rem;
    background: white;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #374151;
    cursor: pointer;
    transition: background 0.1s;
  }
  .back-btn:hover { background: #f3f4f6; }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: #111827;
    margin: 0;
  }

  .badge {
    padding: 0.25rem 0.625rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .badge.survived { background: #d1fae5; color: #065f46; }
  .badge.failed   { background: #fee2e2; color: #991b1b; }

  .header-stats {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
  }

  .hstat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .hstat-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #9ca3af;
  }
  .hstat-val {
    font-size: 1rem;
    font-weight: 600;
    color: #111827;
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

  h2 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #111827;
    margin: 0;
  }

  /* ---- section header ---- */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
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
  .toggle-group button.active { background: #3b82f6; color: white; }
  .toggle-group button:hover:not(.active) { background: #f3f4f6; }

  /* ---- notes ---- */
  .view-note {
    margin: 0;
    font-size: 0.75rem;
    color: #9ca3af;
    font-style: italic;
  }

  /* ---- chart ---- */
  .chart { width: 100%; min-height: 280px; }

  /* ---- table ---- */
  .table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    min-width: 620px;
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
  th:first-child { text-align: left; }

  td {
    text-align: right;
    padding: 0.3rem 0.625rem;
    color: #374151;
    white-space: nowrap;
    border-bottom: 1px solid #f9fafb;
  }
  td:first-child { text-align: left; }

  .depleted-row td { color: #ef4444; }
  .suff-ok { color: #10b981; font-weight: 600; }
  .suff-low { color: #ef4444; }
  .alloc-cell { text-align: left; color: #6b7280; font-size: 0.72rem; white-space: nowrap; }
</style>
