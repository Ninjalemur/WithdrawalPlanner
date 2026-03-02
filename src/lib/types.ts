export interface SimulationInputs {
  portfolioValue: number;
  allocations: Array<{ id: string; pct: number }>;
  strategy: 'constant-dollar' | 'percent-of-portfolio';
  withdrawalAmount: number;  // used when strategy = 'constant-dollar'
  withdrawalPct: number;     // used when strategy = 'percent-of-portfolio', 0-100
  inflationSeries: 'inflation-us' | 'inflation-singapore' | 'manual';
  manualInflationRate: number; // percentage, e.g. 3 = 3%; only used when inflationSeries === 'manual'
  durationYears: number;
}
