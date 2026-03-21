export interface YearResult {
  calendarYear: number;
  calendarMonth: number;              // start month of this annual step (same as SimulationResult.startMonth)
  portfolioBeforeWithdrawal: number; // value at start of year, before withdrawal (and before returns)
  desiredExpense: number;            // inflation-adjusted target withdrawal
  withdrawn: number;                 // actual amount withdrawn
  sufficiency: number;               // withdrawn / desiredExpense: 1.0 = 100% (exactly met), 0 = nothing withdrawn, 2.0 = double desired
  portfolioAfter: number;            // after withdrawal and rebalance
  cumulativeInflationFactor: number; // ∏(1 + inf) for steps 0..i-1; used to compute real values
  allocations: { id: string; pct: number }[]; // target allocation used for rebalance this year
  boundsConflict: boolean; // true if floor > ceiling for this year (floor took priority)
}

export interface SimulationResult {
  startYear: number;
  startMonth: number;  // 1–12; paired with startYear
  endYear: number;
  failed: boolean;       // portfolio hit $0 at some point during the simulation
  years: YearResult[];
  initialPortfolio: number;
  finalPortfolioNominal: number;
  finalPortfolioReal: number; // deflated to simulation start-year dollars
  allocationMode: 'static' | 'glidepath';
  hadBoundsConflict: boolean; // true if any year had a bounds conflict (floor overrode ceiling)
  maxDrawdownNominal: number; // largest % drop from running peak in nominal withdrawals; 0 = none, -1 = -100%
  maxDrawdownReal:    number; // same in real (start-year) terms
  withdrawalCVAll:     number; // CV (SD/mean) of real withdrawals, including $0 (depleted) years
  withdrawalCVNonZero: number; // CV excluding $0 years
}

export interface PercentileStats {
  min: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  max: number;
  mean: number;
}

export interface AggregatedResults {
  simulations: SimulationResult[];
  simulationCount: number;
  successCount: number;
  successRate: number; // 0–1

  // Percentile stats over all simulations (finalPortfolio / initialPortfolio)
  portfolioRatioStats: PercentileStats;

  // Flat pools: all year-level values from all simulations combined
  sufficiencyStats: PercentileStats;
  withdrawalNominalStats: PercentileStats;
  withdrawalRealStats: PercentileStats;

  // Raw arrays for histograms
  finalPortfoliosNominal: number[];      // one per simulation
  finalPortfoliosReal: number[];         // one per simulation, start-year dollars
  finalPortfoliosPctOfInitial: number[]; // one per simulation, ratio (1.0 = 100%)
  withdrawalsNominal: number[];          // flat pool
  withdrawalsReal: number[];             // flat pool, start-year dollars
  sufficiencies: number[];               // flat pool
  maxDrawdownsNominal: number[];         // one per simulation
  maxDrawdownsReal: number[];            // one per simulation
  withdrawalCVsAll: number[];            // one per simulation, CV including $0 years
  withdrawalCVsNonZero: number[];        // one per simulation, CV excluding $0 years
  sufficienciesNonZero: number[];        // flat pool, excluding years where withdrawn === 0

  dataStartYear: number;   // first year of overlapping data range
  dataStartMonth: number;  // first month of overlapping data range (1–12)
  dataEndYear: number;     // last year of overlapping data range
  dataEndMonth: number;    // last month of overlapping data range (1–12)
  strategy: 'constant-dollar' | 'percent-of-portfolio' | 'cape' | 'tobin';
}
