export interface SimulationInputs {
  portfolioValue: number;
  /** Initial (or fixed) allocation. For glidepath this is the starting allocation. */
  allocations: Array<{ id: string; pct: number }>;
  strategy: 'constant-dollar' | 'percent-of-portfolio';
  withdrawalAmount: number;  // used when strategy = 'constant-dollar'
  withdrawalPct: number;     // used when strategy = 'percent-of-portfolio', 0-100
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
