/**
 * Shared types for all data series used in the withdrawal planner.
 */

export interface MonthlyDataPoint {
  year: number;
  month: number;  // 1–12
  /** Value as a decimal (e.g. 0.0248 = 2.48%, -0.1804 = -18.04%) */
  value: number;
}

export interface MonthlyDataSeries {
  /** Unique identifier used in code to reference this series */
  id: string;
  /** Human-readable name shown in the UI */
  label: string;
  category: 'returns' | 'inflation' | 'indicator';
  /** Name of the organisation or publication providing the data */
  source: string;
  /** URL of the source page */
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) when data was last retrieved and updated in this file */
  retrievedDate: string;
  values: MonthlyDataPoint[];
}
