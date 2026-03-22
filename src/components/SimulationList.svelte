<script lang="ts">
  import type { AggregatedResults, SimulationResult } from '../engine/types';

  interface Props {
    results: AggregatedResults;
    onselect: (sim: SimulationResult) => void;
  }
  let { results, onselect }: Props = $props();

  type SortKey = 'year' | 'survival' | 'endValueNominal' | 'endValueReal' | 'endValuePctNominal' | 'endValuePctReal' | 'avgSufficiency' | 'maxDrawdownNominal' | 'maxDrawdownReal' | 'withdrawalVariabilityAll' | 'withdrawalVariabilityNonZero' | 'boundsConflict';
  type SortDir = 'asc' | 'desc';

  interface SortField { key: SortKey; dir: SortDir; }

  type PeriodFilter = { type: 'period';  selected: string[] };
  type BoolFilter   = { type: 'boolean'; value: 'all' | 'yes' | 'no' };
  type RangeFilter  = { type: 'range';   min: number | null; max: number | null };
  type ActiveFilter = PeriodFilter | BoolFilter | RangeFilter;

  const KEY_LABELS: Record<SortKey, string> = {
    year:                'Period Start',
    survival:            'Survived',
    endValueNominal:     'End Value (Nominal)',
    endValueReal:        'End Value (Real)',
    endValuePctNominal:  '% of Initial (Nominal)',
    endValuePctReal:     '% of Initial (Real)',
    avgSufficiency:      'Avg Sufficiency',
    maxDrawdownNominal:          'Max DD (Nominal)',
    maxDrawdownReal:             'Max DD (Real)',
    withdrawalVariabilityAll:    'Variability (Inc.)',
    withdrawalVariabilityNonZero:'Variability (Exc.)',
    boundsConflict:              'Floor Overrode Ceiling',
  };

  const DEFAULT_DIR: Record<SortKey, SortDir> = {
    year:                'asc',
    survival:            'desc',
    endValueNominal:     'desc',
    endValueReal:        'desc',
    endValuePctNominal:  'desc',
    endValuePctReal:     'desc',
    avgSufficiency:      'desc',
    maxDrawdownNominal:           'asc',
    maxDrawdownReal:              'asc',
    withdrawalVariabilityAll:     'asc',
    withdrawalVariabilityNonZero: 'asc',
    boundsConflict:               'desc',
  };

  const ALL_KEYS: SortKey[] = ['year', 'survival', 'endValueNominal', 'endValueReal', 'endValuePctNominal', 'endValuePctReal', 'avgSufficiency', 'maxDrawdownNominal', 'maxDrawdownReal', 'withdrawalVariabilityAll', 'withdrawalVariabilityNonZero', 'boundsConflict'];

  const BOOL_YES: Partial<Record<SortKey, string>> = {
    survival: 'Survived only', boundsConflict: 'Overrode at least once',
  };
  const BOOL_NO: Partial<Record<SortKey, string>> = {
    survival: 'Failed only', boundsConflict: 'Did not override',
  };

  const STORAGE_KEY = 'sim-sort';
  const FILTER_STORAGE_KEY = 'sim-filters';

  function loadSortFields(): SortField[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [{ key: 'year', dir: 'asc' }];
      const parsed = JSON.parse(raw) as unknown[];
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          f =>
            typeof f === 'object' && f !== null &&
            ALL_KEYS.includes((f as SortField).key) &&
            ['asc', 'desc'].includes((f as SortField).dir)
        )
      ) {
        return (parsed as SortField[]).map(f => ({ key: (f as SortField).key, dir: (f as SortField).dir }));
      }
    } catch { /* ignore */ }
    return [{ key: 'year', dir: 'asc' }];
  }

  function loadFilters(): Partial<Record<SortKey, ActiveFilter>> {
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<Record<SortKey, ActiveFilter>>) : {};
    } catch { return {}; }
  }

  let sortFields   = $state<SortField[]>(loadSortFields());
  let filters      = $state<Partial<Record<SortKey, ActiveFilter>>>(loadFilters());
  let openFilter   = $state<SortKey | null>(null);
  let periodSearch = $state('');

  $effect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortFields));
  });

  $effect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  });

  // Close popover on outside click
  $effect(() => {
    if (openFilter === null) return;
    function handleClick(e: MouseEvent) {
      if (!(e.target as Element).closest('.sort-chip-wrap')) {
        openFilter = null;
        periodSearch = '';
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });

  function isActive(key: SortKey) { return sortFields.some(f => f.key === key); }

  function addSort(key: SortKey) {
    sortFields.push({ key, dir: DEFAULT_DIR[key] });
  }

  function removeSort(i: number) {
    if (sortFields.length === 1) return;
    const key = sortFields[i].key;
    delete filters[key];
    if (openFilter === key) openFilter = null;
    sortFields.splice(i, 1);
  }

  function cycleDir(i: number) {
    sortFields[i].dir = sortFields[i].dir === 'asc' ? 'desc' : 'asc';
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const tmp = sortFields[i - 1];
    sortFields[i - 1] = sortFields[i];
    sortFields[i] = tmp;
  }

  function moveDown(i: number) {
    if (i === sortFields.length - 1) return;
    const tmp = sortFields[i + 1];
    sortFields[i + 1] = sortFields[i];
    sortFields[i] = tmp;
  }

  function simVal(sim: SimulationResult, key: SortKey): number {
    if (key === 'year')               return sim.startYear + (sim.startMonth - 1) / 12;
    if (key === 'survival')           return sim.failed ? 0 : 1;
    if (key === 'endValueNominal')    return sim.finalPortfolioNominal;
    if (key === 'endValueReal')       return sim.finalPortfolioReal;
    if (key === 'endValuePctNominal') return sim.initialPortfolio > 0 ? sim.finalPortfolioNominal / sim.initialPortfolio : 0;
    if (key === 'endValuePctReal')    return sim.initialPortfolio > 0 ? sim.finalPortfolioReal    / sim.initialPortfolio : 0;
    if (key === 'avgSufficiency')     return sim.years.length > 0
      ? sim.years.reduce((s, y) => s + y.sufficiency, 0) / sim.years.length
      : 0;
    if (key === 'maxDrawdownNominal')           return sim.maxDrawdownNominal;
    if (key === 'maxDrawdownReal')              return sim.maxDrawdownReal;
    if (key === 'withdrawalVariabilityAll')     return sim.withdrawalCVAll;
    if (key === 'withdrawalVariabilityNonZero') return sim.withdrawalCVNonZero;
    if (key === 'boundsConflict')               return sim.hadBoundsConflict ? 1 : 0;
    return 0;
  }

  function filterKind(key: SortKey): 'period' | 'boolean' | 'range' {
    if (key === 'year') return 'period';
    if (key === 'survival' || key === 'boundsConflict') return 'boolean';
    return 'range';
  }

  const allDates = $derived(
    [...new Set(results.simulations.map(s =>
      `${s.startYear}-${String(s.startMonth).padStart(2, '0')}`
    ))].sort()
  );

  function dateLabel(d: string): string {
    const [year, mon] = d.split('-');
    return `${year} ${MONTHS[parseInt(mon) - 1]}`;
  }

  function matchesDateSearch(d: string, search: string): boolean {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const label = dateLabel(d).toLowerCase();
    return s.split(/\s+/).every(t => label.includes(t));
  }

  function dataRange(key: SortKey): [number, number] {
    if (results.simulations.length === 0) return [0, 1];
    const vals = results.simulations.map(s => simVal(s, key));
    return [Math.min(...vals), Math.max(...vals)];
  }

  function isDollarField(key: SortKey): boolean {
    return key === 'endValueNominal' || key === 'endValueReal';
  }

  function isPctField(key: SortKey): boolean {
    return !isDollarField(key);
  }

  function fmtRangeVal(key: SortKey, v: number): string {
    if (isDollarField(key)) return '$' + Math.round(v).toLocaleString('en-US');
    return parseFloat((v * 100).toFixed(3)) + '%';
  }

  function toDisplayVal(key: SortKey, raw: number): number {
    if (isDollarField(key)) return Math.round(raw);
    return parseFloat((raw * 100).toFixed(3));
  }

  function fromDisplayVal(key: SortKey, display: number): number {
    return isPctField(key) ? display / 100 : display;
  }

  function isFilterActive(key: SortKey): boolean {
    const f = filters[key];
    if (!f) return false;
    if (f.type === 'period')  return f.selected.length < allDates.length;
    if (f.type === 'boolean') return f.value !== 'all';
    return f.min !== null || f.max !== null;
  }

  let sorted = $derived.by(() =>
    [...results.simulations].sort((a, b) => {
      for (const { key, dir } of sortFields) {
        const diff = simVal(a, key) - simVal(b, key);
        if (diff !== 0) return dir === 'asc' ? diff : -diff;
      }
      return 0;
    })
  );

  let filtered = $derived.by(() =>
    sorted.filter(sim => {
      for (const k of Object.keys(filters) as SortKey[]) {
        const f = filters[k];
        if (!f) continue;
        if (f.type === 'period') {
          if (f.selected.length === allDates.length) continue;
          const d = `${sim.startYear}-${String(sim.startMonth).padStart(2, '0')}`;
          if (!f.selected.includes(d)) return false;
        } else if (f.type === 'boolean') {
          if (f.value === 'all') continue;
          const v = simVal(sim, k);
          if (f.value === 'yes' && v !== 1) return false;
          if (f.value === 'no'  && v !== 0) return false;
        } else if (f.type === 'range') {
          const v = simVal(sim, k);
          if (f.min !== null && v < f.min) return false;
          if (f.max !== null && v > f.max) return false;
        }
      }
      return true;
    })
  );

  let showEndValueNom    = $derived(isActive('endValueNominal'));
  let showEndValueReal   = $derived(isActive('endValueReal'));
  let showEndValuePctNom = $derived(isActive('endValuePctNominal'));
  let showEndValuePctReal= $derived(isActive('endValuePctReal'));
  let showAvgSuff        = $derived(isActive('avgSufficiency'));
  let showDDNom          = $derived(isActive('maxDrawdownNominal'));
  let showDDReal         = $derived(isActive('maxDrawdownReal'));
  let showVarAll         = $derived(isActive('withdrawalVariabilityAll'));
  let showVarNonZero     = $derived(isActive('withdrawalVariabilityNonZero'));

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtPeriod = (year: number, month: number) => `${year} ${MONTHS[month - 1]}`;

  const fmtD = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

  function avgSuffFmt(sim: SimulationResult): string {
    if (sim.years.length === 0) return '0.0%';
    const avg = sim.years.reduce((s, y) => s + y.sufficiency, 0) / sim.years.length;
    return (avg * 100).toFixed(1) + '%';
  }
</script>

<div class="sim-list-card">
  <div class="list-header">
    <h2>All Simulations</h2>
    <span class="count">
      {#if filtered.length < results.simulations.length}
        {filtered.length} of {results.simulations.length} shown
      {:else}
        {results.simulations.length} runs
      {/if}
    </span>
  </div>

  <!-- Sort + Filter controls -->
  <div class="sort-bar">
    <span class="sort-label">Sort:</span>

    {#each sortFields as sf, i}
      <div class="sort-chip-wrap">
        <div class="sort-chip active">
          <span class="chip-priority">{i + 1}</span>
          <button class="chip-key" onclick={() => cycleDir(i)} title="Toggle direction">
            {KEY_LABELS[sf.key]}&nbsp;{sf.dir === 'asc' ? '↑' : '↓'}
          </button>
          <button
            class="chip-btn chip-filter"
            class:filter-active={isFilterActive(sf.key)}
            onclick={(e) => { e.stopPropagation(); openFilter = openFilter === sf.key ? null : sf.key; periodSearch = ''; }}
            title="Filter"
          >▾</button>
          {#if i > 0}
            <button class="chip-btn" onclick={() => moveUp(i)} title="Higher priority">◂</button>
          {/if}
          {#if i < sortFields.length - 1}
            <button class="chip-btn" onclick={() => moveDown(i)} title="Lower priority">▸</button>
          {/if}
          {#if sortFields.length > 1}
            <button class="chip-btn chip-remove" onclick={() => removeSort(i)} title="Remove">×</button>
          {/if}
        </div>

        {#if openFilter === sf.key}
          {#if filterKind(sf.key) === 'period'}
            <!-- PERIOD FILTER -->
            <div class="filter-popover">
              <input class="period-search" type="text" placeholder="Search…" bind:value={periodSearch} />
              <div class="period-list">
                {#each allDates.filter(d => matchesDateSearch(d, periodSearch)) as date}
                  <label class="period-item">
                    <input type="checkbox"
                      checked={!filters[sf.key] || (filters[sf.key] as PeriodFilter).selected.includes(date)}
                      onchange={(e) => {
                        const checked = e.currentTarget.checked;
                        const cur = (filters[sf.key] as PeriodFilter)?.selected ?? [...allDates];
                        filters[sf.key] = { type: 'period', selected: checked ? [...cur, date] : cur.filter(d => d !== date) };
                      }}
                    />
                    {dateLabel(date)}
                  </label>
                {/each}
              </div>
              <div class="filter-actions">
                <button onclick={() => { delete filters[sf.key]; }}>All</button>
                <button onclick={() => { filters[sf.key] = { type: 'period', selected: [] }; }}>None</button>
              </div>
            </div>

          {:else if filterKind(sf.key) === 'boolean'}
            <!-- BOOLEAN FILTER -->
            <div class="filter-popover bool-popover">
              {#each ['all', 'yes', 'no'] as val}
                <label class="bool-item">
                  <input type="radio"
                    name="filter-{sf.key}"
                    checked={(filters[sf.key] as BoolFilter)?.value === val || (!filters[sf.key] && val === 'all')}
                    onchange={() => {
                      if (val === 'all') delete filters[sf.key];
                      else filters[sf.key] = { type: 'boolean', value: val as 'yes' | 'no' };
                    }}
                  />
                  {val === 'all' ? 'All' : val === 'yes' ? (BOOL_YES[sf.key] ?? 'Yes') : (BOOL_NO[sf.key] ?? 'No')}
                </label>
              {/each}
            </div>

          {:else}
            <!-- RANGE FILTER -->
            {@const [dMin, dMax] = dataRange(sf.key)}
            {@const rf = filters[sf.key] as RangeFilter | undefined}
            {@const sMin = rf?.min ?? dMin}
            {@const sMax = rf?.max ?? dMax}
            {@const pct = (v: number) => dMax > dMin ? ((v - dMin) / (dMax - dMin)) * 100 : 0}
            <div class="filter-popover range-popover">
              <div class="range-end-labels">
                <span>{fmtRangeVal(sf.key, dMin)}</span>
                <span>{fmtRangeVal(sf.key, dMax)}</span>
              </div>
              <div class="dual-slider">
                <div class="slider-track">
                  <div class="slider-track-fill"
                    style="left:{pct(sMin)}%; width:{pct(sMax)-pct(sMin)}%">
                  </div>
                </div>
                <input type="range" min={dMin} max={dMax} step={(dMax - dMin) / 500} value={sMin}
                  oninput={(e) => {
                    const v = parseFloat(e.currentTarget.value);
                    const cur = filters[sf.key] as RangeFilter | undefined;
                    const curMax = cur?.max ?? dMax;
                    filters[sf.key] = { type: 'range', min: v <= dMin ? null : Math.min(v, curMax), max: cur?.max ?? null };
                  }} />
                <input type="range" min={dMin} max={dMax} step={(dMax - dMin) / 500} value={sMax}
                  oninput={(e) => {
                    const v = parseFloat(e.currentTarget.value);
                    const cur = filters[sf.key] as RangeFilter | undefined;
                    const curMin = cur?.min ?? dMin;
                    filters[sf.key] = { type: 'range', min: cur?.min ?? null, max: v >= dMax ? null : Math.max(v, curMin) };
                  }} />
              </div>
              <div class="range-inputs">
                <input type="number" placeholder={isPctField(sf.key) ? 'Min (%)' : 'Min'}
                  value={rf?.min != null ? toDisplayVal(sf.key, rf.min) : ''}
                  onchange={(e) => {
                    const raw = e.currentTarget.value === '' ? null : fromDisplayVal(sf.key, parseFloat(e.currentTarget.value));
                    const cur = filters[sf.key] as RangeFilter | undefined;
                    filters[sf.key] = { type: 'range', min: raw, max: cur?.max ?? null };
                  }} />
                <input type="number" placeholder={isPctField(sf.key) ? 'Max (%)' : 'Max'}
                  value={rf?.max != null ? toDisplayVal(sf.key, rf.max) : ''}
                  onchange={(e) => {
                    const raw = e.currentTarget.value === '' ? null : fromDisplayVal(sf.key, parseFloat(e.currentTarget.value));
                    const cur = filters[sf.key] as RangeFilter | undefined;
                    filters[sf.key] = { type: 'range', min: cur?.min ?? null, max: raw };
                  }} />
              </div>
              <div class="filter-actions">
                <button onclick={() => { delete filters[sf.key]; }}>Clear</button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/each}

    {#each ALL_KEYS.filter(k => !isActive(k)) as key}
      <button class="sort-chip inactive" onclick={() => addSort(key)}>
        + {KEY_LABELS[key]}
      </button>
    {/each}
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="left">Period Start</th>
          <th>Survived</th>
          {#if showEndValueNom}<th>End Value (Nom.)</th>{/if}
          {#if showEndValueReal}<th>End Value (Real)</th>{/if}
          {#if showEndValuePctNom}<th>% of Initial (Nom.)</th>{/if}
          {#if showEndValuePctReal}<th>% of Initial (Real)</th>{/if}
          {#if showAvgSuff}<th>Avg Sufficiency</th>{/if}
          {#if showDDNom}<th>Max DD (Nominal)</th>{/if}
          {#if showDDReal}<th>Max DD (Real)</th>{/if}
          {#if showVarAll}<th>Variability (Inc.)</th>{/if}
          {#if showVarNonZero}<th>Variability (Exc.)</th>{/if}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as sim}
          <tr
            class="sim-row"
            class:failed-row={sim.failed}
            onclick={() => onselect(sim)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && onselect(sim)}
          >
            <td class="left period">{fmtPeriod(sim.startYear, sim.startMonth)} – {fmtPeriod(sim.endYear, sim.startMonth)}</td>
            <td class="center">
              {#if sim.failed}
                <span class="icon-fail">✗</span>
              {:else}
                <span class="icon-ok">✓</span>
              {/if}
              {#if sim.hadBoundsConflict}
                <span class="icon-conflict" title="Floor overrode ceiling in ≥1 year">⚠</span>
              {/if}
            </td>
            {#if showEndValueNom}<td>{fmtD(sim.finalPortfolioNominal)}</td>{/if}
            {#if showEndValueReal}<td>{fmtD(sim.finalPortfolioReal)}</td>{/if}
            {#if showEndValuePctNom}<td>{sim.initialPortfolio > 0 ? ((sim.finalPortfolioNominal / sim.initialPortfolio) * 100).toFixed(1) + '%' : '—'}</td>{/if}
            {#if showEndValuePctReal}<td>{sim.initialPortfolio > 0 ? ((sim.finalPortfolioReal / sim.initialPortfolio) * 100).toFixed(1) + '%' : '—'}</td>{/if}
            {#if showAvgSuff}<td>{avgSuffFmt(sim)}</td>{/if}
            {#if showDDNom}<td>{(sim.maxDrawdownNominal * 100).toFixed(1)}%</td>{/if}
            {#if showDDReal}<td>{(sim.maxDrawdownReal * 100).toFixed(1)}%</td>{/if}
            {#if showVarAll}<td>{(sim.withdrawalCVAll * 100).toFixed(1)}%</td>{/if}
            {#if showVarNonZero}<td>{(sim.withdrawalCVNonZero * 100).toFixed(1)}%</td>{/if}
            <td class="arrow-cell">›</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .sim-list-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .list-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  h2 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #111827;
    margin: 0;
  }

  .count {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  /* ---- sort bar ---- */
  .sort-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .sort-label {
    font-size: 0.75rem;
    color: #9ca3af;
    font-weight: 600;
    margin-right: 0.25rem;
  }

  /* wrapper provides relative positioning for the popover */
  .sort-chip-wrap {
    position: relative;
    display: inline-flex;
    flex-direction: column;
  }

  .sort-chip {
    display: flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.72rem;
    overflow: hidden;
  }

  .sort-chip.active {
    border: 1px solid #3b82f6;
    background: #eff6ff;
    color: #1d4ed8;
  }

  .sort-chip.inactive {
    border: 1px solid #d1d5db;
    background: white;
    color: #6b7280;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    transition: background 0.1s;
  }
  .sort-chip.inactive:hover { background: #f3f4f6; }

  .chip-priority {
    padding: 0.2rem 0.4rem;
    background: #3b82f6;
    color: white;
    font-weight: 700;
    font-size: 0.68rem;
  }

  .chip-key {
    padding: 0.2rem 0.5rem;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.72rem;
    color: #1d4ed8;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip-key:hover { text-decoration: underline; }

  .chip-btn {
    padding: 0.2rem 0.375rem;
    background: transparent;
    border: none;
    border-left: 1px solid #bfdbfe;
    cursor: pointer;
    font-size: 0.72rem;
    color: #3b82f6;
    line-height: 1;
  }
  .chip-btn:hover { background: #dbeafe; }
  .chip-remove { color: #6b7280; }
  .chip-remove:hover { background: #fee2e2; color: #ef4444; }

  /* filter icon button */
  .chip-filter { color: #6b7280; font-size: 2.16rem; line-height: 1; padding-top: 0; padding-bottom: 0; }
  .chip-filter:hover { background: #dbeafe; color: #3b82f6; }
  .chip-filter.filter-active { color: #f59e0b; font-weight: 700; }

  /* ---- filter popover ---- */
  .filter-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    background: white;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    padding: 0.625rem;
    min-width: 180px;
    font-size: 0.75rem;
    color: #374151;
  }

  .period-search {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    font-size: 0.75rem;
    margin-bottom: 0.375rem;
    outline: none;
  }
  .period-search:focus { border-color: #3b82f6; }

  .period-list {
    max-height: 180px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-bottom: 0.375rem;
  }

  .period-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
    padding: 0.15rem 0.25rem;
    border-radius: 3px;
    user-select: none;
  }
  .period-item:hover { background: #f3f4f6; }

  .bool-popover { min-width: 140px; }
  .bool-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    padding: 0.25rem 0.1rem;
    user-select: none;
  }

  .filter-actions {
    display: flex;
    gap: 0.375rem;
    padding-top: 0.375rem;
    border-top: 1px solid #f3f4f6;
    margin-top: 0.25rem;
  }
  .filter-actions button {
    flex: 1;
    font-size: 0.7rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    color: #374151;
  }
  .filter-actions button:hover { background: #f3f4f6; }

  /* ---- range filter ---- */
  .range-popover { min-width: 220px; }

  .range-end-labels {
    display: flex;
    justify-content: space-between;
    color: #9ca3af;
    font-size: 0.7rem;
    margin-bottom: 0.375rem;
  }

  .dual-slider {
    position: relative;
    height: 2rem;
    display: flex;
    align-items: center;
    margin-bottom: 0.125rem;
  }

  .slider-track {
    position: absolute;
    left: 0; right: 0;
    height: 4px;
    background: #e5e7eb;
    border-radius: 2px;
    pointer-events: none;
  }

  .slider-track-fill {
    position: absolute;
    height: 100%;
    background: #3b82f6;
    border-radius: 2px;
  }

  .dual-slider input[type=range] {
    position: absolute;
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    pointer-events: none;
    height: 4px;
    margin: 0;
  }
  .dual-slider input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    pointer-events: all;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #3b82f6;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    cursor: pointer;
  }
  .dual-slider input[type=range]::-moz-range-thumb {
    pointer-events: all;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #3b82f6;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    cursor: pointer;
    border: none;
  }

  .range-inputs {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }
  .range-inputs input {
    flex: 1;
    min-width: 0;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 0.25rem 0.375rem;
    font-size: 0.75rem;
    outline: none;
  }
  .range-inputs input:focus { border-color: #3b82f6; }

  /* ---- table ---- */
  .table-wrap { overflow-x: auto; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  th {
    text-align: right;
    font-weight: 600;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9ca3af;
    padding: 0.3rem 0.625rem;
    border-bottom: 1px solid #e5e7eb;
  }
  th.left, td.left { text-align: left; }
  th.center, td.center { text-align: center; }

  td {
    text-align: right;
    padding: 0.35rem 0.625rem;
    color: #374151;
    white-space: nowrap;
    border-bottom: 1px solid #f9fafb;
  }

  .sim-row {
    cursor: pointer;
    transition: background 0.1s;
  }
  .sim-row:hover td { background: #f0f9ff; }
  .sim-row:hover .arrow-cell { color: #3b82f6; }
  .failed-row .period { color: #6b7280; }

  .period { font-weight: 500; }

  .icon-ok      { color: #10b981; font-weight: 700; }
  .icon-fail    { color: #ef4444; font-weight: 700; }
  .icon-conflict { color: #d97706; font-size: 0.8rem; margin-left: 0.25rem; }

  .arrow-cell {
    color: #d1d5db;
    font-size: 0.9rem;
    transition: color 0.1s;
    padding-left: 0.375rem;
  }
</style>
