<script lang="ts">
  import Plotly from 'plotly.js-dist-min';
  import type { SimulationResult } from '../engine/types';
  import { capeValues } from '../data/compiled/indicators/cape';

  interface Props {
    sim: SimulationResult;
    strategy: 'constant-dollar' | 'percent-of-portfolio' | 'cape' | 'tobin';
    onback: () => void;
  }
  let { sim, strategy, onback }: Props = $props();

  type MoneyView = 'nominal' | 'real';
  type PortfolioUnit = 'dollars' | 'pct';
  let portfolioInflAdj = $state<MoneyView>('nominal');
  let portfolioUnit    = $state<PortfolioUnit>('dollars');
  let wView  = $state<MoneyView>('nominal');
  let hView  = $state<MoneyView>('nominal');
  let ddView = $state<MoneyView>('nominal');

  let allocEl:               HTMLDivElement | undefined = $state();
  let portfolioEl:           HTMLDivElement | undefined = $state();
  let withdrawalEl:          HTMLDivElement | undefined = $state();
  let sensibleBreakdownEl:   HTMLDivElement | undefined = $state();
  let wRateEl:               HTMLDivElement | undefined = $state();
  let sufficiencyEl:         HTMLDivElement | undefined = $state();
  let histEl:                HTMLDivElement | undefined = $state();
  let drawdownEl:            HTMLDivElement | undefined = $state();

  // Per-year running drawdown: 0% at peak, positive when below (50% = half of peak)
  function runningDrawdown(values: number[]): number[] {
    let peak = -Infinity;
    return values.map(v => {
      if (v > peak) peak = v;
      return peak > 0 ? (peak - v) / peak : 0;
    });
  }

  const nominalDrawdowns = runningDrawdown(sim.years.map(y => y.withdrawn));
  const realDrawdowns    = runningDrawdown(sim.years.map(y => y.withdrawn / y.cumulativeInflationFactor));

  // Withdrawal rate: withdrawn / portfolioBeforeWithdrawal (0 if portfolio was zero)
  const withdrawalRates = sim.years.map(y =>
    y.portfolioBeforeWithdrawal > 0 ? (y.withdrawn / y.portfolioBeforeWithdrawal) * 100 : 0
  );

  // CAPE lookup per year (CAPE strategy only)
  const capePerYear = sim.years.map(y => capeValues.get(y.calendarYear * 100 + y.calendarMonth) ?? null);

  // Annual inflation rate from consecutive cumulativeInflationFactor values
  // cumulativeInflationFactor[i] = product(1+inf[year0..year(i-1)]), so
  // forward ratio gives the rate that applied during calYear[i]
  const inflationRates = sim.years.map((y, i) => {
    if (i < sim.years.length - 1) {
      return (sim.years[i + 1].cumulativeInflationFactor / y.cumulativeInflationFactor - 1) * 100;
    } else if (i > 0) {
      return (y.cumulativeInflationFactor / sim.years[i - 1].cumulativeInflationFactor - 1) * 100;
    }
    return 0;
  });

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtPeriod = (year: number, month: number) => `${year} ${MONTHS[month - 1]}`;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  function preBin(
    data: number[],
    fmtLabel: (lo: number, hi: number) => string,
    targetBins = 25,
  ): { mids: number[]; labels: string[]; counts: number[]; size: number } {
    const n = data.length;
    if (n === 0) return { mids: [], labels: [], counts: [], size: 1 };
    let lo = Infinity, hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) {
      return { mids: [lo], labels: [fmtLabel(lo, lo)], counts: [n], size: 1 };
    }
    const range = hi - lo;
    const raw = range / targetBins;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const size = norm <= 1.5 ? mag : norm <= 3 ? 2 * mag : norm <= 7 ? 5 * mag : 10 * mag;
    const start = Math.floor(lo / size) * size;
    const nBins  = Math.max(1, Math.floor((hi - start) / size) + 1);
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

  const plotConfig = { responsive: true, displayModeBar: false };
  const xs = sim.years.map(y => y.calendarYear);
  const ym = sim.years.map(y => `${y.calendarYear}-${String(y.calendarMonth).padStart(2, '0')}`);

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
    tbond: 'US T-Bond (10Y)',
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
      name: ALLOC_LABELS[id] ?? 'Unknown',
      x: xs,
      y: sim.years.map(y => y.allocations.find(a => a.id === id)?.pct ?? 0),
      customdata: ym,
      line: { color: ALLOC_COLORS[id] ?? '#6b7280' },
      hovertemplate: `%{customdata}<br>${ALLOC_LABELS[id] ?? 'Unknown'}: %{y:.1f}%<extra></extra>`,
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
    const isDollars = portfolioUnit === 'dollars';
    const isReal    = portfolioInflAdj === 'real';
    const toValue = (after: number, cumInf: number): number => {
      const inReal = isReal ? after / cumInf : after;
      return isDollars ? r3(inReal) : r3(inReal / sim.initialPortfolio * 100);
    };
    const initY    = isDollars ? sim.initialPortfolio : 100;
    const yTitle   = isDollars ? `Portfolio Value (${isReal ? 'Real ' : ''}$)` : `Portfolio (% of Initial)`;
    const hoverFmt = isDollars ? '%{customdata}<br>$%{y:,.0f}<extra></extra>' : '%{customdata}<br>%{y:.1f}%<extra></extra>';
    const initHover = isDollars ? `Initial<br>$%{y:,.0f}<extra></extra>` : `Initial<br>%{y:.1f}%<extra></extra>`;
    Plotly.react(
      portfolioEl,
      [
        {
          type: 'scatter', mode: 'markers', name: 'Initial',
          x: [sim.startYear - 1], y: [initY],
          marker: { color: '#9ca3af', size: 9, symbol: 'diamond' },
          hovertemplate: initHover,
        },
        {
          type: 'scatter', mode: 'lines+markers', name: 'Portfolio',
          x: xs, y: sim.years.map(y => toValue(y.portfolioAfter, y.cumulativeInflationFactor)),
          customdata: ym,
          line: { color: '#3b82f6' }, marker: { size: 4 },
          hovertemplate: hoverFmt,
        },
      ],
      {
        ...baseLayout(yTitle),
        showlegend: false,
        yaxis: {
          title: { text: yTitle },
          tickprefix: isDollars ? '$' : '',
          tickformat: isDollars ? ',.0f' : '.1f',
          ticksuffix: !isDollars ? '%' : '',
        },
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!withdrawalEl) return;
    const real = wView === 'real';
    const wY = sim.years.map(y => r3(real ? y.withdrawn      / y.cumulativeInflationFactor : y.withdrawn));
    const dY = sim.years.map(y => r3(real ? y.desiredExpense / y.cumulativeInflationFactor : y.desiredExpense));
    const traces: Plotly.Data[] = [
      {
        type: 'scatter', mode: 'lines+markers', name: 'Withdrawn',
        x: xs, y: wY, customdata: ym, line: { color: '#3b82f6' }, marker: { size: 4 },
        hovertemplate: '%{customdata}<br>$%{y:,.0f}<extra></extra>',
      },
      {
        type: 'scatter', mode: 'lines', name: 'Desired',
        x: xs, y: dY, customdata: ym, line: { color: '#f59e0b', dash: 'dash' },
        hovertemplate: '%{customdata}<br>$%{y:,.0f}<extra></extra>',
      },
    ];
    const conflictYrs = sim.years.filter(y => y.boundsConflict);
    if (conflictYrs.length > 0) {
      traces.push({
        type: 'scatter', mode: 'markers', name: 'Floor overrode ceiling',
        x: conflictYrs.map(y => y.calendarYear),
        y: conflictYrs.map(y => r3(real ? y.withdrawn / y.cumulativeInflationFactor : y.withdrawn)),
        customdata: conflictYrs.map(y => `${y.calendarYear}-${String(y.calendarMonth).padStart(2, '0')}`),
        marker: { color: '#d97706', size: 9, symbol: 'diamond' },
        hovertemplate: '%{customdata}<br>$%{y:,.0f} (floor overrode ceiling)<extra></extra>',
      });
    }
    Plotly.react(
      withdrawalEl,
      traces,
      {
        ...baseLayout(real ? 'Amount (start-yr $)' : 'Amount ($)', 40),
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.18 },
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!sensibleBreakdownEl || strategy !== 'sensible') return;
    const real = wView === 'real';
    const baseY   = sim.years.map(y => r3(real ? y.sensibleBase   / y.cumulativeInflationFactor : y.sensibleBase));
    const extrasY = sim.years.map(y => r3(real ? y.sensibleExtras / y.cumulativeInflationFactor : y.sensibleExtras));
    Plotly.react(
      sensibleBreakdownEl,
      [
        {
          type: 'bar', name: 'Base',
          x: xs, y: baseY, customdata: ym,
          marker: { color: '#3b82f6' },
          hovertemplate: '%{customdata}<br>Base: $%{y:,.0f}<extra></extra>',
        },
        {
          type: 'bar', name: 'Extras',
          x: xs, y: extrasY, customdata: ym,
          marker: { color: '#10b981' },
          hovertemplate: '%{customdata}<br>Extras: $%{y:,.0f}<extra></extra>',
        },
      ],
      {
        ...baseLayout(real ? 'Amount (start-yr $)' : 'Amount ($)', 40),
        barmode: 'stack',
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.18 },
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!sufficiencyEl) return;
    const suffY = sim.years.map(y => r3(y.sufficiency * 100));
    Plotly.react(
      sufficiencyEl,
      [
        {
          type: 'scatter', mode: 'lines+markers', name: 'Sufficiency',
          x: xs, y: suffY, customdata: ym,
          line: { color: '#10b981' }, marker: { size: 4 },
          hovertemplate: '%{customdata}<br>Sufficiency: %{y:.1f}%<extra></extra>',
        },
        {
          type: 'scatter', mode: 'lines', name: '100%',
          x: [xs[0], xs[xs.length - 1]], y: [100, 100],
          line: { color: '#d1d5db', dash: 'dot', width: 1.5 },
          hoverinfo: 'skip',
        },
      ],
      {
        ...baseLayout('Sufficiency (%)', 40),
        yaxis: { title: { text: 'Sufficiency (%)' }, tickformat: '.0f', ticksuffix: '%', rangemode: 'tozero' },
        showlegend: false,
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!wRateEl) return;
    Plotly.react(
      wRateEl,
      [
        {
          type: 'scatter', mode: 'lines+markers', name: 'Withdrawal Rate',
          x: xs, y: withdrawalRates.map(r3), customdata: ym,
          line: { color: '#8b5cf6' }, marker: { size: 4 },
          hovertemplate: '%{customdata}<br>Rate: %{y:.2f}%<extra></extra>',
        },
      ],
      {
        ...baseLayout('Rate (%)'),
        yaxis: { title: { text: 'Rate (%)' }, tickformat: '.1f', ticksuffix: '%', rangemode: 'tozero' },
        showlegend: false,
      },
      plotConfig,
    );
  });

  $effect(() => {
    if (!histEl) return;
    const real = hView === 'real';
    const data = sim.years.map(y => r3(real ? y.withdrawn / y.cumulativeInflationFactor : y.withdrawn));
    const fmtLabel = (lo: number, hi: number) =>
      `$${Math.round(lo).toLocaleString('en-US')}–$${Math.round(hi).toLocaleString('en-US')}`;
    const { mids, labels, counts, size } = preBin(data, fmtLabel);
    const total = data.length;
    const pcts = counts.map(c => total > 0 ? (c / total) * 100 : 0);
    Plotly.react(
      histEl,
      [{
        type: 'bar', x: mids, y: pcts, width: size * 0.96,
        customdata: labels.map((lbl, i) => [counts[i], lbl]),
        marker: { color: '#3b82f6', opacity: 0.85 },
        hovertemplate: '%{customdata[1]}<br>%{customdata[0]} years (%{y:.1f}%)<extra></extra>',
      }],
      { ...baseLayout('% of Years'), xaxis: { tickprefix: '$', tickformat: ',.0f' } },
      plotConfig,
    );
  });

  $effect(() => {
    if (!drawdownEl) return;
    const ddY = (ddView === 'nominal' ? nominalDrawdowns : realDrawdowns).map(v => r3(v * 100));
    Plotly.react(
      drawdownEl,
      [
        {
          type: 'scatter', mode: 'lines+markers', name: 'Drawdown',
          x: xs, y: ddY, customdata: ym,
          line: { color: '#ef4444' }, marker: { size: 4 },
          hovertemplate: '%{customdata}<br>Drawdown: %{y:.1f}%<extra></extra>',
          fill: 'tozeroy', fillcolor: 'rgba(239,68,68,0.08)',
        },
        {
          type: 'scatter', mode: 'lines', name: 'Inflation',
          x: xs, y: inflationRates.map(r3), customdata: ym,
          line: { color: '#f59e0b', dash: 'dot', width: 1.5 },
          hovertemplate: '%{customdata}<br>Inflation: %{y:.1f}%<extra></extra>',
        },
      ],
      {
        ...baseLayout('(%)', 40),
        yaxis: { title: { text: '(%)' }, tickformat: '.0f', ticksuffix: '%' },
        showlegend: true,
        legend: { orientation: 'h' as const, x: 0.5, xanchor: 'center' as const, y: 1.18 },
      },
      plotConfig,
    );
  });

  const hasConflict    = sim.years.some(y => y.boundsConflict);
  const hasFloorCol    = sim.years.some(y => isFinite(y.effectiveFloor));
  const hasCeilingCol  = sim.years.some(y => isFinite(y.effectiveCeiling));

  const fmtD = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  const fmtPct = (n: number) => (n * 100).toFixed(1) + '%';
  const fmtFactor = (f: number) => ((f - 1) * 100).toFixed(1) + '%';
</script>

<div class="detail-panel">

  <!-- Header -->
  <div class="detail-header">
    <button class="back-btn" onclick={onback}>← Back to Results</button>
    <div class="header-title">
      <h1>{fmtPeriod(sim.startYear, sim.startMonth)} – {fmtPeriod(sim.endYear, sim.startMonth)}</h1>
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
    <div class="section-header">
      <h2>Portfolio Value Over Time</h2>
      <div class="toggle-pair">
        <div class="toggle-group">
          <button class:active={portfolioInflAdj === 'nominal'} onclick={() => portfolioInflAdj = 'nominal'}>Nominal</button>
          <button class:active={portfolioInflAdj === 'real'}    onclick={() => portfolioInflAdj = 'real'}>Real</button>
        </div>
        <div class="toggle-group">
          <button class:active={portfolioUnit === 'dollars'} onclick={() => portfolioUnit = 'dollars'}>$</button>
          <button class:active={portfolioUnit === 'pct'}     onclick={() => portfolioUnit = 'pct'}>% of Initial</button>
        </div>
      </div>
    </div>
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

  <!-- Withdrawal Rate Over Time -->
  <div class="card">
    <h2>Withdrawal Rate Over Time</h2>
    <p class="view-note">Annual withdrawal as % of portfolio value at the start of each year.</p>
    <div bind:this={wRateEl} class="chart"></div>
  </div>

  <!-- Sensible Withdrawals: Base + Extras breakdown (stacked bar) -->
  {#if strategy === 'sensible'}
    <div class="card">
      <div class="section-header">
        <h2>Withdrawal Breakdown: Base &amp; Extras</h2>
        <div class="toggle-group">
          <button class:active={wView === 'nominal'} onclick={() => wView = 'nominal'}>Nominal</button>
          <button class:active={wView === 'real'}    onclick={() => wView = 'real'}>Real</button>
        </div>
      </div>
      <p class="view-note">Blue = inflation-adjusted base withdrawal. Green = extras from real portfolio gains above inflation.</p>
      <div bind:this={sensibleBreakdownEl} class="chart"></div>
    </div>
  {/if}

  <!-- Withdrawal Sufficiency Over Time (variable strategies only) -->
  {#if strategy === 'percent-of-portfolio' || strategy === 'cape' || strategy === 'tobin' || strategy === 'sensible'}
    <div class="card">
      <h2>Withdrawal Sufficiency Over Time</h2>
      <p class="view-note">Actual withdrawal as % of desired expense. 100% = fully met, below 100% = shortfall.</p>
      <div bind:this={sufficiencyEl} class="chart"></div>
    </div>
  {/if}

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

  <!-- Withdrawal Drawdown Over Time -->
  <div class="card">
    <div class="section-header">
      <h2>Withdrawal Drawdown Over Time</h2>
      <div class="toggle-group">
        <button class:active={ddView === 'nominal'} onclick={() => ddView = 'nominal'}>Nominal</button>
        <button class:active={ddView === 'real'}    onclick={() => ddView = 'real'}>Real</button>
      </div>
    </div>
    <p class="view-note">% decline from the running peak withdrawal. 0% = at or above all prior withdrawals. Amber dotted line = annual inflation rate.</p>
    <div bind:this={drawdownEl} class="chart"></div>
  </div>

  <!-- Year-by-Year Table -->
  <div class="card">
    <h2>Year-by-Year Data</h2>
    <p class="view-note">
      Each year: <strong>Portfolio Before</strong> is the value at the start of the year.
      The <strong>withdrawal</strong> is taken first, then the year's return is applied to the
      remaining balance to give <strong>Portfolio After</strong>.
      {#if hasConflict}
        <br/><span class="conflict-legend-dot"></span> Effective floor took precedent over effective ceiling.
      {/if}
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Period Start</th>
            <th>Portfolio Before</th>
            <th>Desired Expense</th>
            <th>Withdrawn</th>
            {#if strategy === 'sensible'}<th>Base</th><th>Extras</th>{/if}
            <th>W. Rate %</th>
            <th>Sufficiency</th>
            <th>Portfolio After</th>
            <th>Cum. Inflation</th>
            <th>DD (Nominal)</th>
            <th>DD (Real)</th>
            {#if strategy === 'cape'}<th>CAPE</th>{/if}
            {#if hasFloorCol}<th>Eff. Floor</th>{/if}
            {#if hasCeilingCol}<th>Eff. Ceiling</th>{/if}
            {#if sim.allocationMode === 'glidepath'}
              <th>Allocation</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sim.years as y, i}
            <tr class:depleted-row={y.portfolioAfter === 0 && y.withdrawn < y.desiredExpense}>
              <td>{y.calendarYear}-{String(y.calendarMonth).padStart(2, '0')}</td>
              <td>{fmtD(y.portfolioBeforeWithdrawal)}</td>
              <td>{fmtD(y.desiredExpense)}</td>
              <td>{fmtD(y.withdrawn)}</td>
              {#if strategy === 'sensible'}
                <td>{fmtD(y.sensibleBase)}</td>
                <td>{fmtD(y.sensibleExtras)}</td>
              {/if}
              <td>{withdrawalRates[i].toFixed(2)}%</td>
              <td class:suff-ok={y.sufficiency >= 1} class:suff-low={y.sufficiency < 1}>{fmtPct(y.sufficiency)}</td>
              <td>{fmtD(y.portfolioAfter)}</td>
              <td>{fmtFactor(y.cumulativeInflationFactor)}</td>
              <td class:dd-nonzero={nominalDrawdowns[i] > 0}>{(nominalDrawdowns[i] * 100).toFixed(1)}%</td>
              <td class:dd-nonzero={realDrawdowns[i] > 0}>{(realDrawdowns[i] * 100).toFixed(1)}%</td>
              {#if strategy === 'cape'}
                <td>{capePerYear[i] !== null ? capePerYear[i]!.toFixed(1) : '—'}</td>
              {/if}
              {#if hasFloorCol}
                <td class:bounds-conflict-cell={y.boundsConflict}>
                  {isFinite(y.effectiveFloor) ? fmtD(y.effectiveFloor) : '—'}
                  {#if y.boundsConflict}<span class="conflict-dot" title="Floor took precedent over ceiling"></span>{/if}
                </td>
              {/if}
              {#if hasCeilingCol}
                <td class:bounds-conflict-cell={y.boundsConflict}>
                  {isFinite(y.effectiveCeiling) ? fmtD(y.effectiveCeiling) : '—'}
                  {#if y.boundsConflict}<span class="conflict-dot" title="Floor took precedent over ceiling"></span>{/if}
                </td>
              {/if}
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
  .toggle-pair {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

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
  .dd-nonzero { color: #ef4444; }
  .alloc-cell { text-align: left; color: #6b7280; font-size: 0.72rem; white-space: nowrap; }
  .bounds-conflict-cell { background: #fef9c3; }
  .conflict-dot {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #ca8a04;
    margin-left: 0.25rem;
    vertical-align: middle;
  }
  .conflict-legend-dot {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: #ca8a04;
    vertical-align: middle;
    margin-right: 0.1rem;
  }
</style>
