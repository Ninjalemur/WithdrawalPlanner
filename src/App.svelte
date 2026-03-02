<script lang="ts">
  import InputPanel from './components/InputPanel.svelte';
  import ResultsPanel from './components/ResultsPanel.svelte';
  import type { SimulationInputs } from './lib/types';
  import { runSimulations } from './engine/simulate';
  import type { AggregatedResults } from './engine/types';

  let results = $state<AggregatedResults | null>(null);

  function handleRun(inputs: SimulationInputs) {
    results = runSimulations(inputs);
  }
</script>

<div class="layout">
  <InputPanel onrun={handleRun} />

  <main class="results-area">
    {#if results}
      <ResultsPanel {results} />
    {:else}
      <div class="empty-state">
        <h1>Withdrawal Planner</h1>
        <p>Configure your inputs and click Run Simulation to see results.</p>
      </div>
    {/if}
  </main>
</div>

<style>
  .layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .results-area {
    flex: 1;
    overflow-y: auto;
  }

  .empty-state {
    padding: 2rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    color: #111827;
  }

  p {
    color: #9ca3af;
    font-style: italic;
  }
</style>
