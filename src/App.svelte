<script lang="ts">
  import InputPanel from './components/InputPanel.svelte';
  import ResultsPanel from './components/ResultsPanel.svelte';
  import type { SimulationInputs } from './lib/types';
  import { runSimulations } from './engine/simulate';
  import type { AggregatedResults } from './engine/types';

  let results = $state<AggregatedResults | null>(null);
  let bannerDismissed = $state(localStorage.getItem('banner-dismissed') === '1');

  function handleRun(inputs: SimulationInputs) {
    results = runSimulations(inputs);
  }

  function dismissBanner() {
    bannerDismissed = true;
    localStorage.setItem('banner-dismissed', '1');
  }
</script>

<div class="shell">
  {#if !bannerDismissed}
    <div class="banner-overlay">
      <div class="banner">
        <button class="banner-close" onclick={dismissBanner} aria-label="Dismiss">&#x2715;</button>
        <p>
          <strong>Welcome to Withdrawal Planner</strong> — a retirement withdrawal simulator that stress-tests your strategy against historical market data.
          Configure your portfolio, withdrawal strategy, and time horizon using the <strong>input panel</strong>,
          then hit <strong>Run Simulation</strong> to see results in the center of the page.
        </p>
      </div>
    </div>
  {/if}

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
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }

  .banner-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    pointer-events: none;
  }

  .banner {
    position: relative;
    background: #fff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.10);
    padding: 1.5rem 1.75rem;
    max-width: 480px;
    width: calc(100% - 3rem);
    font-size: 0.9rem;
    color: #1e3a5f;
    line-height: 1.6;
    pointer-events: all;
  }

  .banner p {
    margin: 0;
    color: #1e3a5f;
    font-style: normal;
  }

  .banner-close {
    position: absolute;
    top: 0.6rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: #93c5fd;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.15rem 0.3rem;
    line-height: 1;
    border-radius: 3px;
  }

  .banner-close:hover {
    color: #1e40af;
    background: #eff6ff;
  }

  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .results-area {
    flex: 1;
    overflow-y: auto;
  }

  @media (max-width: 768px) {
    .shell {
      height: auto;
      min-height: 100dvh;
      overflow: visible;
    }
    .layout {
      flex-direction: column;
      overflow: visible;
    }
    .results-area {
      overflow-y: visible;
    }
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
