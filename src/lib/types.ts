export interface WithdrawalBound {
  type: 'pct' | 'dollar';
  value: number; // percent (e.g. 3 = 3%) or nominal dollars at simulation start
}

export interface SimulationInputs {
  portfolioValue: number;
  /** Initial (or fixed) allocation. For glidepath this is the starting allocation. */
  allocations: Array<{ id: string; pct: number }>;
  strategy: 'constant-dollar' | 'percent-of-portfolio' | 'cape' | 'tobin';
  withdrawalAmount: number;  // used when strategy = 'constant-dollar'
  withdrawalPct: number;     // used when strategy = 'percent-of-portfolio', 0-100
  capeBasePct:    number;    // used when strategy = 'cape', e.g. 1.95 (= 1.95%)
  capeMultiplier: number;    // used when strategy = 'cape', e.g. 0.35
  tobinPrevYearPct:     number;  // used when strategy = 'tobin': weight on prior year's withdrawal (0–100)
  tobinSpendingRate:    number;  // used when strategy = 'tobin': spending rate applied to portfolio (0–100)
  tobinInflationAdjust: boolean; // used when strategy = 'tobin': inflate prior year component by annual CPI
  withdrawalFloor:   WithdrawalBound | null; // null = disabled; applies to 'pct' and 'cape'
  withdrawalCeiling: WithdrawalBound | null; // null = disabled; applies to 'pct' and 'cape'
  inflationSeries: 'inflation-us' | 'inflation-singapore' | 'manual';
  manualInflationRate: number; // percentage, e.g. 3 = 3%; only used when inflationSeries === 'manual'
  durationYears: number;
  startYearMin: number | null;  // null = unconstrained; more restrictive vs data range wins
  startYearMax: number | null;  // null = unconstrained; more restrictive vs data range wins
  allocationMode: 'static' | 'glidepath';
  glidepath?: {
    finalAllocations: Array<{ id: string; pct: number }>;
    stepCondition: 'unconditional' | 'sp500-ath';
    stepSize: number;      // percentage points, e.g. 0.4
    athThreshold: number;  // x%; only used for sp500-ath condition
  };
}
