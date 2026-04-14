/**
 * import-gold.ts
 *
 * Reads the DataHub gold prices CSV and derives monthly price returns.
 *
 * CSV format (datahub.io/core/gold-prices, monthly-processed.csv):
 *   Date,Price
 *   1833-01-01,18.930
 *   ...
 *   2026-03-01,4855.540
 *
 * Return formula (matches ERN forward-looking convention used for sp500/tbond):
 *   r[t] = price[t+1] / price[t] - 1, assigned to month t
 *
 * This means the return for month t reflects the change from the end of month t
 * to the end of month t+1 — consistent with how import-ern.ts computes sp500/tbond.
 * Using the reverse convention would shift gold by one month vs. the other assets,
 * causing subtle portfolio return mismatches in multi-asset simulations.
 *
 * Note: pre-1933 returns are mostly zero (USD gold price was fixed under the gold standard).
 *
 * Run: npx tsx scripts/import-gold.ts
 */

import { readFileSync, writeFileSync } from 'fs';

const GOLD_CSV = 'src/data/csv/gold_prices_datahub.csv';
const OUT_PATH = 'src/data/raw/returns/gold.ts';
const RETRIEVED_DATE = '2026-04-14';

interface PriceRow { year: number; month: number; price: number }
interface Point    { year: number; month: number; value: number }

function parseGoldCsv(csvPath: string): PriceRow[] {
  const lines = readFileSync(csvPath, 'utf8').split('\n');
  const rows: PriceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const dateStr = line.slice(0, comma);
    const price   = parseFloat(line.slice(comma + 1));
    if (isNaN(price)) continue;
    const parts = dateStr.split('-');
    if (parts.length < 2) continue;
    rows.push({ year: parseInt(parts[0]), month: parseInt(parts[1]), price });
  }
  return rows;
}

function computeReturns(rows: PriceRow[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    points.push({
      year:  rows[i].year,
      month: rows[i].month,
      value: rows[i + 1].price / rows[i].price - 1,
    });
  }
  return points;
}

function toEntries(points: Point[]): string {
  return points
    .map(p => `    { year: ${p.year}, month: ${String(p.month).padStart(2, ' ')}, value: ${p.value.toFixed(8)} },`)
    .join('\n');
}

const rows   = parseGoldCsv(GOLD_CSV);
const points = computeReturns(rows);

const first = points[0];
const last  = points[points.length - 1];
const coverageStr = `${first.year}-${String(first.month).padStart(2,'0')} through ${last.year}-${String(last.month).padStart(2,'0')} (${points.length} months)`;

console.log(`gold: ${rows.length} price rows → ${points.length} monthly returns`);
console.log(`  Coverage: ${coverageStr}`);

writeFileSync(OUT_PATH, `import type { MonthlyDataSeries } from '../../types';

// Monthly price returns for Gold (USD per troy oz).
// Values are decimals: 0.02 = +2.0%.
// Note: pre-1933 returns are mostly zero (USD gold price was fixed under the gold standard).
//
// Source: DataHub — Gold Prices (Monthly)
//   https://datahub.io/core/gold-prices
//   File: monthly-processed.csv, stored locally at src/data/csv/gold_prices_datahub.csv
// Retrieved: ${RETRIEVED_DATE}
// Derived: monthly return = price[t+1] / price[t] - 1, assigned to month t
//   (matches ERN forward-looking convention used for sp500 and tbond)
// Coverage: ${coverageStr}
export const gold: MonthlyDataSeries = {
  id: 'gold',
  label: 'Gold',
  category: 'returns',
  source: 'DataHub — Gold Prices (Monthly)',
  sourceUrl: 'https://datahub.io/core/gold-prices',
  retrievedDate: '${RETRIEVED_DATE}',
  values: [
${toEntries(points)}
  ],
};
`, 'utf8');

console.log(`Written: ${OUT_PATH}`);
console.log('Done.');
