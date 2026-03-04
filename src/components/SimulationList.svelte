<script lang="ts">
  import type { AggregatedResults, SimulationResult } from '../engine/types';

  interface Props {
    results: AggregatedResults;
    onselect: (sim: SimulationResult) => void;
  }
  let { results, onselect }: Props = $props();

  type SortKey = 'year' | 'survival' | 'endValue' | 'avgSufficiency' | 'maxDrawdownNominal' | 'maxDrawdownReal';
  type SortDir = 'asc' | 'desc';

  interface SortField { key: SortKey; dir: SortDir; }

  const KEY_LABELS: Record<SortKey, string> = {
    year:                'Year',
    survival:            'Survived',
    endValue:            'End Value',
    avgSufficiency:      'Avg Sufficiency',
    maxDrawdownNominal:  'Max DD (Nominal)',
    maxDrawdownReal:     'Max DD (Real)',
  };

  const DEFAULT_DIR: Record<SortKey, SortDir> = {
    year:                'asc',
    survival:            'desc',
    endValue:            'desc',
    avgSufficiency:      'desc',
    maxDrawdownNominal:  'asc',   // least severe (closest to 0) first by default
    maxDrawdownReal:     'asc',
  };

  const ALL_KEYS: SortKey[] = ['year', 'survival', 'endValue', 'avgSufficiency', 'maxDrawdownNominal', 'maxDrawdownReal'];

  const STORAGE_KEY = 'sim-sort';

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

  let sortFields = $state<SortField[]>(loadSortFields());

  $effect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortFields));
  });

  function isActive(key: SortKey) { return sortFields.some(f => f.key === key); }

  function addSort(key: SortKey) {
    sortFields.push({ key, dir: DEFAULT_DIR[key] });
  }

  function removeSort(i: number) {
    if (sortFields.length === 1) return;
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
    if (key === 'year')               return sim.startYear;
    if (key === 'survival')           return sim.failed ? 0 : 1;
    if (key === 'endValue')           return sim.finalPortfolioNominal;
    if (key === 'avgSufficiency')     return sim.years.length > 0
      ? sim.years.reduce((s, y) => s + y.sufficiency, 0) / sim.years.length
      : 0;
    if (key === 'maxDrawdownNominal') return sim.maxDrawdownNominal;
    if (key === 'maxDrawdownReal')    return sim.maxDrawdownReal;
    return 0;
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

  let showEndValue  = $derived(isActive('endValue'));
  let showAvgSuff   = $derived(isActive('avgSufficiency'));
  let showDDNom     = $derived(isActive('maxDrawdownNominal'));
  let showDDReal    = $derived(isActive('maxDrawdownReal'));

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
    <span class="count">{results.simulations.length} runs</span>
  </div>

  <!-- Sort controls -->
  <div class="sort-bar">
    <span class="sort-label">Sort:</span>

    {#each sortFields as sf, i}
      <div class="sort-chip active">
        <span class="chip-priority">{i + 1}</span>
        <button class="chip-key" onclick={() => cycleDir(i)} title="Toggle direction">
          {KEY_LABELS[sf.key]}&nbsp;{sf.dir === 'asc' ? '↑' : '↓'}
        </button>
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
          <th class="left">Period</th>
          <th>Survived</th>
          {#if showEndValue}<th>End Value</th>{/if}
          {#if showAvgSuff}<th>Avg Sufficiency</th>{/if}
          {#if showDDNom}<th>Max DD (Nominal)</th>{/if}
          {#if showDDReal}<th>Max DD (Real)</th>{/if}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as sim}
          <tr
            class="sim-row"
            class:failed-row={sim.failed}
            onclick={() => onselect(sim)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && onselect(sim)}
          >
            <td class="left period">{sim.startYear}–{sim.endYear}</td>
            <td class="center">
              {#if sim.failed}
                <span class="icon-fail">✗</span>
              {:else}
                <span class="icon-ok">✓</span>
              {/if}
            </td>
            {#if showEndValue}<td>{fmtD(sim.finalPortfolioNominal)}</td>{/if}
            {#if showAvgSuff}<td>{avgSuffFmt(sim)}</td>{/if}
            {#if showDDNom}<td>{(sim.maxDrawdownNominal * 100).toFixed(1)}%</td>{/if}
            {#if showDDReal}<td>{(sim.maxDrawdownReal * 100).toFixed(1)}%</td>{/if}
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

  .icon-ok   { color: #10b981; font-weight: 700; }
  .icon-fail { color: #ef4444; font-weight: 700; }

  .arrow-cell {
    color: #d1d5db;
    font-size: 0.9rem;
    transition: color 0.1s;
    padding-left: 0.375rem;
  }
</style>
