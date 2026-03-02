import type { SimulationInputs } from '../lib/types';
import { sp500 } from '../data/returns/sp500';
import { tbond } from '../data/returns/tbond';
import { gold } from '../data/returns/gold';
import { usInflation } from '../data/inflation/us';
import { singaporeInflation } from '../data/inflation/singapore';
import type {
  AggregatedResults,
  PercentileStats,
  SimulationResult,
  YearResult,
} from './types';

// ---------------------------------------------------------------------------
// Static lookup maps — built once at module load
// ---------------------------------------------------------------------------

const RETURNS: Record<string, Map<number, number>> = {
  sp500: new Map(sp500.values.map(d => [d.year, d.value])),
  tbond: new Map(tbond.values.map(d => [d.year, d.value])),
  gold:  new Map(gold.values.map(d => [d.year, d.value])),
};

const INFLATION: Record<string, Map<number, number>> = {
  'inflation-us':        new Map(usInflation.values.map(d => [d.year, d.value])),
  'inflation-singapore': new Map(singaporeInflation.values.map(d => [d.year, d.value])),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapYearRange(m: Map<number, number>): [number, number] {
  const years = Array.from(m.keys());
  return [Math.min(...years), Math.max(...years)];
}

function interpolatedPercentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

function computeStats(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { min: 0, p5: 0, p25: 0, median: 0, p75: 0, p95: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    min:    sorted[0],
    p5:     interpolatedPercentile(sorted, 5),
    p25:    interpolatedPercentile(sorted, 25),
    median: interpolatedPercentile(sorted, 50),
    p75:    interpolatedPercentile(sorted, 75),
    p95:    interpolatedPercentile(sorted, 95),
    max:    sorted[sorted.length - 1],
    mean,
  };
}

// ---------------------------------------------------------------------------
// Single simulation
// ---------------------------------------------------------------------------

function runOneSimulation(
  startYear: number,
  inputs: SimulationInputs,
  assetMaps: Map<number, number>[],
  allocations: number[],           // decimals summing to 1
  getInflation: (year: number) => number,
): SimulationResult {
  const { portfolioValue: initialPortfolio, durationYears, strategy, withdrawalAmount, withdrawalPct } = inputs;

  // Initial desired expense (= first year's withdrawal target, used as the inflation-adjusted baseline)
  const initialDesired =
    strategy === 'constant-dollar'
      ? withdrawalAmount
      : initialPortfolio * (withdrawalPct / 100);

  // Asset values, initialised proportionally to target allocation
  let assetValues = allocations.map(a => a * initialPortfolio);

  let failed = false;
  let cumInflation = 1; // factor for start year = 1 (base)

  const years: YearResult[] = [];

  for (let i = 0; i < durationYears; i++) {
    const calYear = startYear + i;

    // desiredExpense this year = initialDesired × cumulative inflation since start
    const desiredExpense = initialDesired * cumInflation;

    // Step 1 — apply returns
    for (let j = 0; j < assetMaps.length; j++) {
      assetValues[j] *= 1 + (assetMaps[j].get(calYear) ?? 0);
    }
    const portfolioBeforeWithdrawal = assetValues.reduce((s, v) => s + v, 0);

    // Step 2 — determine withdrawal and portfolio after
    const targetWithdrawal =
      strategy === 'constant-dollar'
        ? desiredExpense
        : portfolioBeforeWithdrawal * (withdrawalPct / 100);

    let withdrawn: number;
    let portfolioAfter: number;

    if (failed || portfolioBeforeWithdrawal <= 0) {
      withdrawn = 0;
      portfolioAfter = 0;
      failed = true;
    } else if (portfolioBeforeWithdrawal < targetWithdrawal) {
      withdrawn = portfolioBeforeWithdrawal; // take all remaining
      portfolioAfter = 0;
      failed = true;
    } else {
      withdrawn = targetWithdrawal;
      portfolioAfter = portfolioBeforeWithdrawal - withdrawn;
    }

    const sufficiency = desiredExpense > 0 ? withdrawn / desiredExpense : 0;

    // Step 3 — rebalance to target allocation
    assetValues = allocations.map(a => a * portfolioAfter);

    years.push({
      calendarYear: calYear,
      portfolioBeforeWithdrawal,
      desiredExpense,
      withdrawn,
      sufficiency,
      portfolioAfter,
      cumulativeInflationFactor: cumInflation,
    });

    // Update cumulative inflation: this year's rate applies to next year's desired expense
    cumInflation *= 1 + getInflation(calYear);
  }

  const finalPortfolioNominal = years[years.length - 1].portfolioAfter;
  // Deflate final portfolio using the full cumulative inflation through the simulation
  // (cumInflation has been updated once per year including the last year)
  const finalPortfolioReal = finalPortfolioNominal / cumInflation;

  return {
    startYear,
    endYear: startYear + durationYears - 1,
    failed,
    years,
    initialPortfolio,
    finalPortfolioNominal,
    finalPortfolioReal,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runSimulations(inputs: SimulationInputs): AggregatedResults {
  const assetMaps  = inputs.allocations.map(a => RETURNS[a.id]);
  const allocations = inputs.allocations.map(a => a.pct / 100);

  // Inflation getter
  let getInflation: (year: number) => number;
  let inflMap: Map<number, number> | undefined;

  if (inputs.inflationSeries === 'manual') {
    const rate = inputs.manualInflationRate / 100;
    getInflation = () => rate;
  } else {
    inflMap = INFLATION[inputs.inflationSeries];
    getInflation = (year: number) => inflMap!.get(year) ?? 0;
  }

  // Find overlapping year range across all selected return series + inflation
  let rangeMin = -Infinity;
  let rangeMax =  Infinity;

  for (const m of assetMaps) {
    const [lo, hi] = mapYearRange(m);
    rangeMin = Math.max(rangeMin, lo);
    rangeMax = Math.min(rangeMax, hi);
  }
  if (inflMap) {
    const [lo, hi] = mapYearRange(inflMap);
    rangeMin = Math.max(rangeMin, lo);
    rangeMax = Math.min(rangeMax, hi);
  }

  // Run one simulation per valid start year
  const simulations: SimulationResult[] = [];
  for (let y = rangeMin; y <= rangeMax - inputs.durationYears + 1; y++) {
    simulations.push(runOneSimulation(y, inputs, assetMaps, allocations, getInflation));
  }

  const empty: AggregatedResults = {
    simulations: [],
    simulationCount: 0,
    successCount: 0,
    successRate: 0,
    portfolioRatioStats:    computeStats([]),
    sufficiencyStats:       computeStats([]),
    withdrawalNominalStats: computeStats([]),
    withdrawalRealStats:    computeStats([]),
    finalPortfoliosNominal:      [],
    finalPortfoliosReal:         [],
    finalPortfoliosPctOfInitial: [],
    withdrawalsNominal: [],
    withdrawalsReal:    [],
    sufficiencies:      [],
    dataStartYear: rangeMin,
    dataEndYear:   rangeMax,
  };

  if (simulations.length === 0) return empty;

  // Aggregate flat pools
  const finalPortfoliosNominal:      number[] = [];
  const finalPortfoliosReal:         number[] = [];
  const finalPortfoliosPctOfInitial: number[] = [];
  const withdrawalsNominal: number[] = [];
  const withdrawalsReal:    number[] = [];
  const sufficiencies:      number[] = [];

  for (const sim of simulations) {
    finalPortfoliosNominal.push(sim.finalPortfolioNominal);
    finalPortfoliosReal.push(sim.finalPortfolioReal);
    finalPortfoliosPctOfInitial.push(sim.finalPortfolioNominal / sim.initialPortfolio);

    for (const yr of sim.years) {
      withdrawalsNominal.push(yr.withdrawn);
      withdrawalsReal.push(yr.withdrawn / yr.cumulativeInflationFactor);
      sufficiencies.push(yr.sufficiency);
    }
  }

  const successCount = simulations.filter(s => !s.failed).length;

  return {
    simulations,
    simulationCount: simulations.length,
    successCount,
    successRate: successCount / simulations.length,
    portfolioRatioStats:    computeStats(finalPortfoliosPctOfInitial),
    sufficiencyStats:       computeStats(sufficiencies),
    withdrawalNominalStats: computeStats(withdrawalsNominal),
    withdrawalRealStats:    computeStats(withdrawalsReal),
    finalPortfoliosNominal,
    finalPortfoliosReal,
    finalPortfoliosPctOfInitial,
    withdrawalsNominal,
    withdrawalsReal,
    sufficiencies,
    dataStartYear: rangeMin,
    dataEndYear:   rangeMax,
  };
}
