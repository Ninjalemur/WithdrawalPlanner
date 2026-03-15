export interface WithdrawalBound {
  type: 'pct' | 'dollar';
  value: number; // percent (e.g. 3 = 3%) or nominal dollars at simulation start
}

export interface SimulationInputs {
  portfolioValue: number;
  /** Initial (or fixed) allocation. For glidepath this is the starting allocation. */
  allocations: Array<{ id: string; pct: number }>;
  strategy: 'constant-dollar' | 'percent-of-portfolio' | 'cape';
  withdrawalAmount: number;  // used when strategy = 'constant-dollar'
  withdrawalPct: number;     // used when strategy = 'percent-of-portfolio', 0-100
  capeBasePct:    number;    // used when strategy = 'cape', e.g. 1.5 (= 1.5%)
  capeMultiplier: number;    // used when strategy = 'cape', e.g. 0.5
  withdrawalFloor:   WithdrawalBound | null; // null = disabled; applies to 'pct' and 'cape'
  withdrawalCeiling: WithdrawalBound | null; // null = disabled; applies to 'pct' and 'cape'
  inflationSeries: 'inflation-us' | 'inflation-singapore' | 'manual';
  manualInflationRate: number; // percentage, e.g. 3 = 3%; only used when inflationSeries === 'manual'
  durationYears: number;
  allocationMode: 'static' | 'glidepath';
  glidepath?: {
    finalAllocations: Array<{ id: string; pct: number }>;
    stepCondition: 'unconditional' | 'sp500-ath';
    stepSize: number;      // percentage points, e.g. 0.4
    athThreshold: number;  // x%; only used for sp500-ath condition
  };
}
