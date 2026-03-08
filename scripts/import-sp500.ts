/**
 * import-sp500.ts
 *
 * Reads Shiller's monthly S&P 500 data CSV and computes monthly total returns
 * (price change + dividend). Writes the result to src/data/raw/returns/sp500.ts.
 *
 * Formula: r_t = (P_{t+1} - P_t + D_t/12) / P_t
 *   where D_t is the annualised trailing dividend for month t.
 *
 * Truncation rule (option 1): only include months where D_t > 0.
 * The last such month in this dataset is June 2023; its return uses July 2023's price.
 *
 * Run: bun scripts/import-sp500.ts
 */

import { readFileSync, writeFileSync } from 'fs';

const CSV_PATH = 'g:/Downloads/filtered_data.csv';
const OUT_PATH = 'src/data/raw/returns/sp500.ts';

// ---------------------------------------------------------------------------
// Parse CSV
// ---------------------------------------------------------------------------

interface Row {
  year: number;
  month: number;
  price: number;
  dividend: number; // annualised
}

const lines = readFileSync(CSV_PATH, 'utf8').split('\n');
const rows: Row[] = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = line.split(',');
  const dateStr = cols[0]; // "YYYY-MM-DD"
  const price = parseFloat(cols[1]);
  const dividend = parseFloat(cols[2]);
  if (!dateStr || isNaN(price) || price <= 0) continue;
  const [yearStr, monthStr] = dateStr.split('-');
  rows.push({ year: parseInt(yearStr), month: parseInt(monthStr), price, dividend });
}

// ---------------------------------------------------------------------------
// Compute monthly total returns
// ---------------------------------------------------------------------------

const points: { year: number; month: number; value: number }[] = [];

for (let i = 0; i < rows.length - 1; i++) {
  const cur = rows[i];
  const next = rows[i + 1];
  if (cur.dividend <= 0) continue; // truncate: no dividend data
  const monthlyReturn = (next.price - cur.price + cur.dividend / 12) / cur.price;
  points.push({ year: cur.year, month: cur.month, value: monthlyReturn });
}

// ---------------------------------------------------------------------------
// Emit TypeScript file
// ---------------------------------------------------------------------------

const entries = points
  .map(p => `    { year: ${p.year}, month: ${String(p.month).padStart(2, ' ')}, value: ${p.value.toFixed(8)} },`)
  .join('\n');

const firstPoint = points[0];
const lastPoint = points[points.length - 1];

const content = `import type { MonthlyDataSeries } from '../../types';

// Monthly total returns (price change + dividends) for the S&P 500.
// Values are decimals: 0.015 = +1.5%, -0.03 = -3.0%.
//
// Source: Robert Shiller, Irrational Exuberance dataset
//   http://www.econ.yale.edu/~shiller/data.htm
// Retrieved: 2026-03-08
//
// Formula: r_t = (P_{t+1} - P_t + D_t/12) / P_t
//   P_t     = monthly S&P 500 price index
//   D_t     = annualised trailing 12-month dividend (Shiller column)
//   D_t/12  = estimated monthly dividend payment
//
// Coverage: ${firstPoint.year}-${String(firstPoint.month).padStart(2, '0')} through ${lastPoint.year}-${String(lastPoint.month).padStart(2, '0')}
// Truncated at ${lastPoint.year}-${String(lastPoint.month).padStart(2, '0')}: Shiller dividend data ends there.
// Points: ${points.length}
export const sp500: MonthlyDataSeries = {
  id: 'sp500',
  label: 'S&P 500 (incl. dividends)',
  category: 'returns',
  source: 'Robert Shiller, Irrational Exuberance',
  sourceUrl: 'http://www.econ.yale.edu/~shiller/data.htm',
  retrievedDate: '2026-03-08',
  values: [
${entries}
  ],
};
`;

writeFileSync(OUT_PATH, content, 'utf8');
console.log(`Written ${points.length} monthly return points to ${OUT_PATH}`);
console.log(`Coverage: ${firstPoint.year}-${firstPoint.month} through ${lastPoint.year}-${lastPoint.month}`);
