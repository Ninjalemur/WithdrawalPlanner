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

// S&P 500 price index (base 1.0 before 1928, compounded forward each year)
const sp500PriceIndex = new Map<number, number>();
{
  let price = 1.0;
  const sorted = [...sp500.values].sort((a, b) => a.year - b.year);
  for (const { year, value } of sorted) {
    price *= 1 + value;
    sp500PriceIndex.set(year, price);
  }
}

// Running all-time high: max S&P 500 price level from 1928 through each year
const sp500RunningATH = new Map<number, number>();
{
  let ath = 0;
  const sorted = [...sp500PriceIndex.entries()].sort((a, b) => a[0] - b[0]);
  for (const [year, price] of sorted) {
    ath = Math.max(ath, price);
    sp500RunningATH.set(year, ath);
  }
}

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
// Glidepath step function
// ---------------------------------------------------------------------------

/**
 * Move `current` allocations one step toward `final`, proportional to each
 * asset's remaining distance in each direction.
 *
 * Invariant preserved: sum(result) === sum(current) === 1.0
 *
 * If total distance in one direction ≤ stepFraction, all assets in that
 * direction jump directly to their final values (natural clamping).
 */
function applyGlidepathStep(
  current: number[],    // fractions summing to 1
  final: number[],      // fractions summing to 1
  stepFraction: number, // step size as a fraction (e.g. 0.004 for 0.4 ppt)
): number[] {
  const result = [...current];

  function applyDirection(sign: 1 | -1) {
    const moving = result
      .map((v, i) => ({ i, remaining: (final[i] - v) * sign }))
      .filter(m => m.remaining > 1e-10);

    if (moving.length === 0) return;

    const totalRemaining = moving.reduce((s, m) => s + m.remaining, 0);

    if (totalRemaining <= stepFraction + 1e-10) {
      // All assets in this direction can reach final in one step
      for (const m of moving) result[m.i] = final[m.i];
    } else {
      // Proportional allocation — no individual asset will overshoot
      for (const m of moving) {
        result[m.i] += sign * stepFraction * m.remaining / totalRemaining;
      }
    }
  }

  applyDirection(1);   // assets that need to increase
  applyDirection(-1);  // assets that need to decrease
  return result;
}

// ---------------------------------------------------------------------------
// Single simulation
// ---------------------------------------------------------------------------

interface GlidepathConfig {
  finalTarget:    number[];                            // fractions, same order as initialTarget
  stepFraction:   number;
  stepCondition:  'unconditional' | 'sp500-ath';
  athThreshold:   number;                             // percentage, e.g. 5
}

function runOneSimulation(
  startYear:     number,
  inputs:        SimulationInputs,
  assetMaps:     Map<number, number>[],
  assetIds:      string[],
  initialTarget: number[],                           // fractions summing to 1
  glidepath:     GlidepathConfig | null,
  getInflation:  (year: number) => number,
): SimulationResult {
  const { portfolioValue: initialPortfolio, durationYears, strategy, withdrawalAmount, withdrawalPct } = inputs;

  const initialDesired =
    strategy === 'constant-dollar'
      ? withdrawalAmount
      : initialPortfolio * (withdrawalPct / 100);

  // Mutable working copy of the target allocation (changes each step for glidepath)
  let currentTarget = [...initialTarget];

  let assetValues = currentTarget.map(a => a * initialPortfolio);
  let failed = false;
  let cumInflation = 1;

  const years: YearResult[] = [];

  for (let i = 0; i < durationYears; i++) {
    const calYear = startYear + i;

    // Glidepath: update target allocation before rebalancing (skip year 0)
    if (i > 0 && glidepath) {
      let takeStep = glidepath.stepCondition === 'unconditional';

      if (glidepath.stepCondition === 'sp500-ath') {
        const currentLevel = sp500PriceIndex.get(calYear) ?? 0;
        const athLevel     = sp500RunningATH.get(calYear)  ?? 0;
        takeStep = athLevel > 0 && currentLevel >= athLevel * (1 - glidepath.athThreshold / 100);
      }

      if (takeStep) {
        currentTarget = applyGlidepathStep(currentTarget, glidepath.finalTarget, glidepath.stepFraction);
      }
    }

    const desiredExpense = initialDesired * cumInflation;

    // Apply returns
    for (let j = 0; j < assetMaps.length; j++) {
      assetValues[j] *= 1 + (assetMaps[j].get(calYear) ?? 0);
    }
    const portfolioBeforeWithdrawal = assetValues.reduce((s, v) => s + v, 0);

    // Determine withdrawal
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
      withdrawn = portfolioBeforeWithdrawal;
      portfolioAfter = 0;
      failed = true;
    } else {
      withdrawn = targetWithdrawal;
      portfolioAfter = portfolioBeforeWithdrawal - withdrawn;
    }

    const sufficiency = desiredExpense > 0 ? withdrawn / desiredExpense : 0;

    // Rebalance to current target allocation
    assetValues = currentTarget.map(a => a * portfolioAfter);

    years.push({
      calendarYear: calYear,
      portfolioBeforeWithdrawal,
      desiredExpense,
      withdrawn,
      sufficiency,
      portfolioAfter,
      cumulativeInflationFactor: cumInflation,
      allocations: assetIds.map((id, j) => ({ id, pct: currentTarget[j] * 100 })),
    });

    cumInflation *= 1 + getInflation(calYear);
  }

  const finalPortfolioNominal = years[years.length - 1].portfolioAfter;
  const finalPortfolioReal = finalPortfolioNominal / cumInflation;

  return {
    startYear,
    endYear: startYear + durationYears - 1,
    failed,
    years,
    initialPortfolio,
    finalPortfolioNominal,
    finalPortfolioReal,
    allocationMode: glidepath ? 'glidepath' : 'static',
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runSimulations(inputs: SimulationInputs): AggregatedResults {
  const assetIds    = inputs.allocations.map(a => a.id);
  const assetMaps   = inputs.allocations.map(a => RETURNS[a.id]);
  const initialTarget = inputs.allocations.map(a => a.pct / 100);

  // Build glidepath config (null for static mode)
  let glidepath: GlidepathConfig | null = null;
  if (inputs.allocationMode === 'glidepath' && inputs.glidepath) {
    const gp = inputs.glidepath;
    // Map finalAllocations to the same order as assetIds
    const finalTarget = assetIds.map(id => {
      const fa = gp.finalAllocations.find(a => a.id === id);
      return fa ? fa.pct / 100 : 0;
    });
    glidepath = {
      finalTarget,
      stepFraction:  gp.stepSize / 100,
      stepCondition: gp.stepCondition,
      athThreshold:  gp.athThreshold,
    };
  }

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
    simulations.push(
      runOneSimulation(y, inputs, assetMaps, assetIds, initialTarget, glidepath, getInflation)
    );
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
