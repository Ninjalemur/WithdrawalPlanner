import type { SimulationInputs } from '../lib/types';
import { sp500AnnualReturns } from '../data/compiled/returns/sp500';
import { tbondAnnualReturns } from '../data/compiled/returns/tbond';
import { goldAnnualReturns  } from '../data/compiled/returns/gold';
import { usInflationMap        } from '../data/compiled/inflation/us';
import { singaporeInflationMap } from '../data/compiled/inflation/singapore';
import { sp500PriceIndex, sp500RunningATH } from '../data/compiled/sp500Index';
import { capeValues } from '../data/compiled/indicators/cape';
import type {
  AggregatedResults,
  PercentileStats,
  SimulationResult,
  YearResult,
} from './types';

// ---------------------------------------------------------------------------
// Static lookup maps — imported from pre-compiled files (built by scripts/compile-data.ts)
// ---------------------------------------------------------------------------

const ANNUAL_RETURNS: Record<string, Map<number, number>> = {
  sp500: sp500AnnualReturns,
  tbond: tbondAnnualReturns,
  gold:  goldAnnualReturns,
};

const INFLATION_MAPS: Record<string, Map<number, number>> = {
  'inflation-us':        usInflationMap,
  'inflation-singapore': singaporeInflationMap,
};

// ---------------------------------------------------------------------------
// Month/year helpers
// ---------------------------------------------------------------------------

/** YYYYMM key: e.g. ymKey(2025, 3) = 202503 */
function ymKey(year: number, month: number): number {
  return year * 100 + month;
}

/** Linear month index: lm = year*12 + (month-1). Invertible, monotonically increasing. */
function ymToLM(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function lmToYM(lm: number): { year: number; month: number } {
  return { year: Math.floor(lm / 12), month: (lm % 12) + 1 };
}

/** Min and max linear month index across all YYYYMM keys in the map. */
function mapMonthRange(m: Map<number, number>): [number, number] {
  let minLM = Infinity;
  let maxLM = -Infinity;
  for (const key of m.keys()) {
    const lm = ymToLM(Math.floor(key / 100), key % 100);
    if (lm < minLM) minLM = lm;
    if (lm > maxLM) maxLM = lm;
  }
  return [minLM, maxLM];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Max drawdown helper
// ---------------------------------------------------------------------------

function computeMaxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

// ---------------------------------------------------------------------------
// Withdrawal variability helper
// ---------------------------------------------------------------------------

function computeCV(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// ---------------------------------------------------------------------------
// Glidepath step function
// ---------------------------------------------------------------------------

/**
 * Move `current` allocations one step toward `final`, proportional to each
 * asset's remaining distance in each direction.
 *
 * Invariant preserved: sum(result) === sum(current) === 1.0
 */
function applyGlidepathStep(
  current: number[],
  final: number[],
  stepFraction: number,
): number[] {
  const result = [...current];

  function applyDirection(sign: 1 | -1) {
    const moving = result
      .map((v, i) => ({ i, remaining: (final[i] - v) * sign }))
      .filter(m => m.remaining > 1e-10);

    if (moving.length === 0) return;

    const totalRemaining = moving.reduce((s, m) => s + m.remaining, 0);

    if (totalRemaining <= stepFraction + 1e-10) {
      for (const m of moving) result[m.i] = final[m.i];
    } else {
      for (const m of moving) {
        result[m.i] += sign * stepFraction * m.remaining / totalRemaining;
      }
    }
  }

  applyDirection(1);
  applyDirection(-1);
  return result;
}

// ---------------------------------------------------------------------------
// Single simulation
// ---------------------------------------------------------------------------

interface GlidepathConfig {
  finalTarget:    number[];
  stepFraction:   number;
  stepCondition:  'unconditional' | 'sp500-ath';
  athThreshold:   number;
}

function runOneSimulation(
  startYear:     number,
  startMonth:    number,
  inputs:        SimulationInputs,
  assetMaps:     Map<number, number>[],  // precomputed annual return maps (YYYYMM key)
  assetIds:      string[],
  initialTarget: number[],
  glidepath:     GlidepathConfig | null,
  getInflation:  (ymKeyVal: number) => number,
): SimulationResult {
  const {
    portfolioValue: initialPortfolio, durationYears, strategy,
    withdrawalAmount, withdrawalPct, capeBasePct, capeMultiplier,
    tobinPrevYearPct, tobinSpendingRate, tobinInflationAdjust,
    sensibleMode, sensibleAmount, sensiblePct, sensibleExtrasRate,
    withdrawalFloor, withdrawalCeiling,
  } = inputs;

  // For constant-dollar, initialDesired is fixed upfront.
  // For pct-of-portfolio, cape, and tobin, it is captured from the first year's formula result.
  let initialDesired = strategy === 'constant-dollar' ? withdrawalAmount : 0;

  let currentTarget = [...initialTarget];
  let assetValues = currentTarget.map(a => a * initialPortfolio);
  let failed = false;
  let cumInflation = 1;

  // Tobin/Yale: track actual withdrawn (post-bounds) and prior cumInflation for annual rate
  let prevYearActual   = 0;
  let prevCumInflation = 1;

  // Sensible Withdrawals: track portfolio-after-withdrawal from previous year
  let prevPortfolioAfterWithdrawal = initialPortfolio;

  const years: YearResult[] = [];

  for (let i = 0; i < durationYears; i++) {
    const calYear = startYear + i;
    const stepKey = ymKey(calYear, startMonth);

    // Glidepath: update target allocation before rebalancing (skip step 0)
    if (i > 0 && glidepath) {
      let takeStep = glidepath.stepCondition === 'unconditional';

      if (glidepath.stepCondition === 'sp500-ath') {
        const currentLevel = sp500PriceIndex.get(stepKey) ?? 0;
        const athLevel     = sp500RunningATH.get(stepKey)  ?? 0;
        takeStep = athLevel > 0 && currentLevel >= athLevel * (1 - glidepath.athThreshold / 100);
      }

      if (takeStep) {
        currentTarget = applyGlidepathStep(currentTarget, glidepath.finalTarget, glidepath.stepFraction);
      }
    }

    // Withdrawal-first model: snapshot portfolio, take withdrawal, then apply returns to remainder
    const portfolioBeforeWithdrawal = assetValues.reduce((s, v) => s + v, 0);

    // Compute the formula withdrawal for this year (what the strategy says to withdraw)
    let formulaWithdrawal: number;
    let sensibleBase   = 0;
    let sensibleExtras = 0;
    if (strategy === 'constant-dollar') {
      formulaWithdrawal = initialDesired * cumInflation;
    } else if (strategy === 'cape') {
      const capeVal = capeValues.get(stepKey) ?? 17; // 17 = historical median fallback
      formulaWithdrawal = portfolioBeforeWithdrawal * (capeBasePct / 100 + capeMultiplier / capeVal);
    } else if (strategy === 'tobin') {
      if (i === 0) {
        formulaWithdrawal = portfolioBeforeWithdrawal * (tobinSpendingRate / 100);
      } else {
        const annualInflation = prevCumInflation > 0 ? cumInflation / prevCumInflation : 1;
        const prevAdj = tobinInflationAdjust ? prevYearActual * annualInflation : prevYearActual;
        const w = tobinPrevYearPct / 100;
        formulaWithdrawal = w * prevAdj + (1 - w) * (tobinSpendingRate / 100) * portfolioBeforeWithdrawal;
      }
    } else if (strategy === 'sensible') {
      const initialBase = sensibleMode === 'amount'
        ? sensibleAmount
        : initialPortfolio * (sensiblePct / 100);
      sensibleBase = initialBase * cumInflation;
      if (i > 0) {
        const annualInfl = prevCumInflation > 0 ? cumInflation / prevCumInflation : 1;
        const realGain = portfolioBeforeWithdrawal - prevPortfolioAfterWithdrawal * annualInfl;
        if (realGain > 0) sensibleExtras = (sensibleExtrasRate / 100) * realGain;
      }
      formulaWithdrawal = sensibleBase + sensibleExtras;
    } else {
      formulaWithdrawal = portfolioBeforeWithdrawal * (withdrawalPct / 100);
    }

    // For variable strategies, capture the first-year formula result as the real benchmark
    if (i === 0 && strategy !== 'constant-dollar') {
      initialDesired = formulaWithdrawal;
    }

    // desiredExpense = first-year withdrawal inflated — the real benchmark for sufficiency
    const desiredExpense = initialDesired * cumInflation;

    // Apply floor/ceiling bounds (variable strategies only); floor wins when lo > hi
    let targetWithdrawal = formulaWithdrawal;
    let effectiveFloor   = -Infinity;
    let effectiveCeiling =  Infinity;
    let boundsConflict   = false;
    if (strategy !== 'constant-dollar' && (withdrawalFloor || withdrawalCeiling)) {
      const loVals: number[] = [];
      if (withdrawalFloor?.dollarValue != null)
        loVals.push(withdrawalFloor.dollarValue * cumInflation);
      if (withdrawalFloor?.pctValue != null)
        loVals.push(portfolioBeforeWithdrawal * withdrawalFloor.pctValue / 100);
      if (loVals.length) effectiveFloor = Math.max(...loVals);

      const hiVals: number[] = [];
      if (withdrawalCeiling?.dollarValue != null)
        hiVals.push(withdrawalCeiling.dollarValue * cumInflation);
      if (withdrawalCeiling?.pctValue != null)
        hiVals.push(portfolioBeforeWithdrawal * withdrawalCeiling.pctValue / 100);
      if (hiVals.length) effectiveCeiling = Math.min(...hiVals);

      boundsConflict = isFinite(effectiveFloor) && isFinite(effectiveCeiling) && effectiveFloor > effectiveCeiling;
      targetWithdrawal = boundsConflict
        ? effectiveFloor
        : Math.max(effectiveFloor, Math.min(effectiveCeiling, targetWithdrawal));
    }

    // Tobin: capture targetWithdrawal (pre-depletion clamp) as the feedback value for next year
    if (strategy === 'tobin') {
      prevYearActual   = targetWithdrawal;
    }
    // Sensible + Tobin: track cumInflation for annual rate computation
    prevCumInflation = cumInflation;

    let withdrawn: number;
    let portfolioAfterWithdrawal: number;

    if (failed || portfolioBeforeWithdrawal <= 0) {
      withdrawn = 0;
      portfolioAfterWithdrawal = 0;
      failed = true;
    } else if (portfolioBeforeWithdrawal < targetWithdrawal) {
      withdrawn = portfolioBeforeWithdrawal;
      portfolioAfterWithdrawal = 0;
      failed = true;
    } else {
      withdrawn = targetWithdrawal;
      portfolioAfterWithdrawal = portfolioBeforeWithdrawal - withdrawn;
    }

    const sufficiency = desiredExpense > 0 ? withdrawn / desiredExpense : 0;

    // Sensible: track post-withdrawal portfolio for next year's real-gain computation
    if (strategy === 'sensible') prevPortfolioAfterWithdrawal = portfolioAfterWithdrawal;

    // Rebalance to post-withdrawal amount, then apply precomputed 12-month compound return
    assetValues = currentTarget.map(a => a * portfolioAfterWithdrawal);
    for (let j = 0; j < assetMaps.length; j++) {
      assetValues[j] *= 1 + (assetMaps[j].get(stepKey) ?? 0);
    }
    const portfolioAfter = assetValues.reduce((s, v) => s + v, 0);

    years.push({
      calendarYear: calYear,
      calendarMonth: startMonth,
      portfolioBeforeWithdrawal,
      desiredExpense,
      withdrawn,
      sufficiency,
      portfolioAfter,
      cumulativeInflationFactor: cumInflation,
      allocations: assetIds.map((id, j) => ({ id, pct: currentTarget[j] * 100 })),
      effectiveFloor,
      effectiveCeiling,
      boundsConflict,
      sensibleBase,
      sensibleExtras,
    });

    // Inflation: YoY rate at same month of next year
    const inflKey = ymKey(calYear + 1, startMonth);
    cumInflation *= 1 + getInflation(inflKey);
  }

  const finalPortfolioNominal = years[years.length - 1].portfolioAfter;
  const finalPortfolioReal = finalPortfolioNominal / cumInflation;

  const maxDrawdownNominal = computeMaxDrawdown(years.map(y => y.withdrawn));
  const maxDrawdownReal    = computeMaxDrawdown(years.map(y => y.withdrawn / y.cumulativeInflationFactor));

  const realWithdrawalsAll     = years.map(y => y.withdrawn / y.cumulativeInflationFactor);
  const realWithdrawalsNonZero = realWithdrawalsAll.filter(v => v > 0);
  const withdrawalCVAll     = computeCV(realWithdrawalsAll);
  const withdrawalCVNonZero = computeCV(
    realWithdrawalsNonZero.length > 0 ? realWithdrawalsNonZero : realWithdrawalsAll
  );
  const hadBoundsConflict = years.some(y => y.boundsConflict);

  return {
    startYear,
    startMonth,
    endYear: startYear + durationYears, // year of final portfolio measurement (end of last return period)
    failed,
    years,
    initialPortfolio,
    finalPortfolioNominal,
    finalPortfolioReal,
    allocationMode: glidepath ? 'glidepath' : 'static',
    hadBoundsConflict,
    maxDrawdownNominal,
    maxDrawdownReal,
    withdrawalCVAll,
    withdrawalCVNonZero,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runSimulations(inputs: SimulationInputs): AggregatedResults {
  const assetIds    = inputs.allocations.map(a => a.id);
  const assetMaps   = inputs.allocations.map(a => ANNUAL_RETURNS[a.id]);
  const initialTarget = inputs.allocations.map(a => a.pct / 100);

  // Build glidepath config (null for static mode)
  let glidepath: GlidepathConfig | null = null;
  if (inputs.allocationMode === 'glidepath' && inputs.glidepath) {
    const gp = inputs.glidepath;
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
  let getInflation: (ymKeyVal: number) => number;
  let inflMap: Map<number, number> | undefined;

  if (inputs.inflationSeries === 'manual') {
    const rate = inputs.manualInflationRate / 100;
    getInflation = () => rate;
  } else {
    inflMap = INFLATION_MAPS[inputs.inflationSeries];
    getInflation = (key: number) => inflMap!.get(key) ?? 0;
  }

  // Find overlapping month range — track returns and inflation separately for correct lastStart
  let rangeMinLM   = -Infinity;
  let returnsMaxLM =  Infinity;  // min of all return map maxes
  let inflMaxLM    =  Infinity;  // inflation map max (Infinity when manual)

  for (const m of assetMaps) {
    const [lo, hi] = mapMonthRange(m);
    rangeMinLM   = Math.max(rangeMinLM,   lo);
    returnsMaxLM = Math.min(returnsMaxLM, hi);
  }
  if (inflMap) {
    const [lo, hi] = mapMonthRange(inflMap);
    rangeMinLM = Math.max(rangeMinLM, lo);
    inflMaxLM  = Math.min(inflMaxLM,  hi);
  }

  const rangeMaxLM = Math.min(returnsMaxLM, inflMaxLM); // for early-return guard and rangeMinLM check

  // Returns need: startLM + 12*(N-1) ≤ returnsMaxLM
  // Inflation needs: startLM + 12*N ≤ inflMaxLM
  // Use the more restrictive of both constraints
  const lastStart = Math.min(
    returnsMaxLM - 12 * (inputs.durationYears - 1),
    inflMaxLM    - 12 * inputs.durationYears,
  );

  // Apply year filter — more restrictive of user input vs data range wins
  let effectiveMinLM = rangeMinLM;
  let effectiveMaxLM = lastStart;
  if (inputs.startYearMin !== null) {
    effectiveMinLM = Math.max(effectiveMinLM, ymToLM(inputs.startYearMin, 1));
  }
  if (inputs.startYearMax !== null) {
    // "Latest end year Y": last return key (= effectiveMaxLM + 12*(N-1)) must end in year ≤ Y.
    // Key YYYY ends in year YYYY+1, so last key year ≤ Y-1 → last key ≤ ymToLM(Y-1, 12)
    // → effectiveMaxLM ≤ ymToLM(Y-1, 12) - 12*(N-1) = ymToLM(Y-N, 12)
    effectiveMaxLM = Math.min(effectiveMaxLM, ymToLM(inputs.startYearMax - inputs.durationYears, 12));
  }

  // Display range: first sim's start → end of last return period
  // Return key YYYYMM covers the 12-month period ending at month YYYYMM+12 (same month next year)
  const { year: dataStartYear, month: dataStartMonth } = lmToYM(
    isFinite(effectiveMinLM) ? effectiveMinLM : (isFinite(rangeMinLM) ? rangeMinLM : 0)
  );
  const lastWindowEndLM = effectiveMaxLM + 12 * inputs.durationYears;
  const { year: dataEndYear, month: dataEndMonth } = lmToYM(
    isFinite(effectiveMaxLM) && effectiveMaxLM >= effectiveMinLM
      ? lastWindowEndLM
      : (isFinite(rangeMinLM) ? rangeMinLM : 0)
  );

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
    withdrawalsNominal:      [],
    withdrawalsReal:         [],
    sufficiencies:           [],
    maxDrawdownsNominal:     [],
    maxDrawdownsReal:        [],
    withdrawalCVsAll:        [],
    withdrawalCVsNonZero:    [],
    sufficienciesNonZero:    [],
    dataStartYear,
    dataStartMonth,
    dataEndYear,
    dataEndMonth,
    strategy: inputs.strategy,
  };

  if (!isFinite(rangeMinLM) || !isFinite(rangeMaxLM) || lastStart < rangeMinLM || effectiveMinLM > effectiveMaxLM) return empty;

  // Run one simulation per valid start month
  const simulations: SimulationResult[] = [];
  for (let lm = effectiveMinLM; lm <= effectiveMaxLM; lm++) {
    const { year, month } = lmToYM(lm);
    simulations.push(
      runOneSimulation(year, month, inputs, assetMaps, assetIds, initialTarget, glidepath, getInflation)
    );
  }

  if (simulations.length === 0) return empty;

  const finalPortfoliosNominal:      number[] = [];
  const finalPortfoliosReal:         number[] = [];
  const finalPortfoliosPctOfInitial: number[] = [];
  const withdrawalsNominal:    number[] = [];
  const withdrawalsReal:       number[] = [];
  const sufficiencies:         number[] = [];
  const maxDrawdownsNominal:   number[] = [];
  const maxDrawdownsReal:      number[] = [];
  const withdrawalCVsAll:      number[] = [];
  const withdrawalCVsNonZero:  number[] = [];
  const sufficienciesNonZero:  number[] = [];

  for (const sim of simulations) {
    finalPortfoliosNominal.push(sim.finalPortfolioNominal);
    finalPortfoliosReal.push(sim.finalPortfolioReal);
    finalPortfoliosPctOfInitial.push(sim.finalPortfolioNominal / sim.initialPortfolio);
    maxDrawdownsNominal.push(sim.maxDrawdownNominal);
    maxDrawdownsReal.push(sim.maxDrawdownReal);
    withdrawalCVsAll.push(sim.withdrawalCVAll);
    withdrawalCVsNonZero.push(sim.withdrawalCVNonZero);

    for (const yr of sim.years) {
      withdrawalsNominal.push(yr.withdrawn);
      withdrawalsReal.push(yr.withdrawn / yr.cumulativeInflationFactor);
      sufficiencies.push(yr.sufficiency);
      if (yr.withdrawn > 0) sufficienciesNonZero.push(yr.sufficiency);
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
    maxDrawdownsNominal,
    maxDrawdownsReal,
    withdrawalCVsAll,
    withdrawalCVsNonZero,
    sufficienciesNonZero,
    dataStartYear,
    dataStartMonth,
    dataEndYear,
    dataEndMonth,
    strategy: inputs.strategy,
  };
}
