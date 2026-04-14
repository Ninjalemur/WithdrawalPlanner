/**
 * import-ern.ts
 *
 * Reads the ERN SWR Toolbox cumulative index CSV and derives monthly total
 * returns for S&P 500, 10Y Treasury, and Gold.
 *
 * Formula: r_t = (index[t+1] - index[t]) / index[t]
 *
 * The last CSV row has no following month, so it yields no return.
 *
 * Run: npx tsx scripts/import-ern.ts
 */

import { readFileSync, writeFileSync } from 'fs';

const CSV_PATH  = 'g:/Downloads/ERN_assets.csv';
const OUT_SP500 = 'src/data/raw/returns/sp500.ts';
const OUT_TBOND = 'src/data/raw/returns/tbond.ts';
const OUT_CAPE  = 'src/data/raw/indicators/cape.ts';

// ---------------------------------------------------------------------------
// Parse CSV
// ---------------------------------------------------------------------------

interface Row {
  year:   number;
  month:  number;
  spx:    number;
  tbond:  number;
  gold:   number;
  cape:   number;
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/"/g, '').replace(/,/g, ''));
}

const lines = readFileSync(CSV_PATH, 'utf8').split('\n');
const rows: Row[] = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  // Split carefully: values may be quoted and contain commas
  // Format: month,year,spx,tbond,gold  where later fields may be "1,234.56"
  // Use a simple regex split that respects quoted fields
  const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g);
  if (!cols || cols.length < 6) continue;
  rows.push({
    month: parseInt(cols[0]),
    year:  parseInt(cols[1]),
    spx:   parseNum(cols[2]),
    tbond: parseNum(cols[3]),
    gold:  parseNum(cols[4]),
    cape:  parseNum(cols[5]),
  });
}

console.log(`Parsed ${rows.length} rows (${rows[0].year}-${rows[0].month} through ${rows[rows.length-1].year}-${rows[rows.length-1].month})`);

// ---------------------------------------------------------------------------
// Compute monthly returns
// ---------------------------------------------------------------------------

interface Point { year: number; month: number; value: number }

const spxPoints:   Point[] = [];
const tbondPoints: Point[] = [];

for (let i = 0; i < rows.length - 1; i++) {
  const cur  = rows[i];
  const next = rows[i + 1];
  spxPoints  .push({ year: cur.year, month: cur.month, value: (next.spx   - cur.spx)   / cur.spx   });
  tbondPoints.push({ year: cur.year, month: cur.month, value: (next.tbond - cur.tbond) / cur.tbond });
}

// CAPE is a direct value per month (not a return — no differencing needed)
const capePoints: Point[] = rows.map(r => ({ year: r.year, month: r.month, value: r.cape }));

console.log(`Computed ${spxPoints.length} monthly returns`);
console.log(`  First: ${spxPoints[0].year}-${spxPoints[0].month}, Last: ${spxPoints[spxPoints.length-1].year}-${spxPoints[spxPoints.length-1].month}`);
console.log(`Parsed ${capePoints.length} CAPE values`);

// ---------------------------------------------------------------------------
// Emit TypeScript files
// ---------------------------------------------------------------------------

function toEntries(points: Point[]): string {
  return points
    .map(p => `    { year: ${p.year}, month: ${String(p.month).padStart(2, ' ')}, value: ${p.value.toFixed(8)} },`)
    .join('\n');
}

function toEntriesCape(points: Point[]): string {
  return points
    .map(p => `    { year: ${p.year}, month: ${String(p.month).padStart(2, ' ')}, value: ${p.value.toFixed(4)} },`)
    .join('\n');
}

function coverageComment(points: Point[]): string {
  const f = points[0], l = points[points.length - 1];
  return `// Coverage: ${f.year}-${String(f.month).padStart(2,'0')} through ${l.year}-${String(l.month).padStart(2,'0')} (${points.length} months)`;
}

// --- S&P 500 ---
writeFileSync(OUT_SP500, `import type { MonthlyDataSeries } from '../../types';

// Monthly total returns (price change + dividends reinvested) for the S&P 500.
// Values are decimals: 0.015 = +1.5%, -0.03 = -3.0%.
//
// Source: Early Retirement Now – SWR Toolbox spreadsheet (Karsten Jeske)
//   https://earlyretirementnow.com/2017/01/25/the-ultimate-guide-to-safe-withdrawal-rates-part-7-toolbox/
// Underlying data: Robert Shiller (Yale) – http://www.econ.yale.edu/~shiller/data.htm
// Retrieved: 2026-03-08
// Derived: monthly return = (index[t+1] - index[t]) / index[t]
${coverageComment(spxPoints)}
export const sp500: MonthlyDataSeries = {
  id: 'sp500',
  label: 'S&P 500 (incl. dividends)',
  category: 'returns',
  source: 'Early Retirement Now (Karsten Jeske) / Robert Shiller (Yale)',
  sourceUrl: 'https://earlyretirementnow.com/2017/01/25/the-ultimate-guide-to-safe-withdrawal-rates-part-7-toolbox/',
  retrievedDate: '2026-03-08',
  values: [
${toEntries(spxPoints)}
  ],
};
`, 'utf8');
console.log(`Written: ${OUT_SP500}`);

// --- T-Bond ---
writeFileSync(OUT_TBOND, `import type { MonthlyDataSeries } from '../../types';

// Monthly total returns for US 10-Year Treasury Bonds.
// Values are decimals: 0.005 = +0.5%.
//
// Source: Early Retirement Now – SWR Toolbox spreadsheet (Karsten Jeske)
//   https://earlyretirementnow.com/2017/01/25/the-ultimate-guide-to-safe-withdrawal-rates-part-7-toolbox/
// Underlying data: US 10Y Treasury Benchmark — Federal Reserve, NYU-Stern, Shiller (back to 1871)
// Retrieved: 2026-03-08
// Derived: monthly return = (index[t+1] - index[t]) / index[t]
${coverageComment(tbondPoints)}
export const tbond: MonthlyDataSeries = {
  id: 'tbond',
  label: 'US 10Y Treasury Bond',
  category: 'returns',
  source: 'Early Retirement Now (Karsten Jeske) / Federal Reserve, NYU-Stern, Shiller',
  sourceUrl: 'https://earlyretirementnow.com/2017/01/25/the-ultimate-guide-to-safe-withdrawal-rates-part-7-toolbox/',
  retrievedDate: '2026-03-08',
  values: [
${toEntries(tbondPoints)}
  ],
};
`, 'utf8');
console.log(`Written: ${OUT_TBOND}`);

// --- CAPE ---
writeFileSync(OUT_CAPE, `import type { MonthlyDataSeries } from '../../types';

// Monthly CAPE (Cyclically Adjusted Price-to-Earnings) ratio, aka Shiller P/E 10.
// Values are raw ratios (e.g. 25.3 = CAPE of 25.3), not percentages or decimals.
//
// Source: Early Retirement Now – SWR Toolbox spreadsheet (Karsten Jeske)
//   https://earlyretirementnow.com/2017/01/25/the-ultimate-guide-to-safe-withdrawal-rates-part-7-toolbox/
// Underlying data: Robert Shiller (Yale) – http://www.econ.yale.edu/~shiller/data.htm
// Retrieved: 2026-03-15
${coverageComment(capePoints)}
export const cape: MonthlyDataSeries = {
  id: 'cape',
  label: 'CAPE (Shiller P/E 10)',
  category: 'indicator',
  source: 'Early Retirement Now (Karsten Jeske) / Robert Shiller (Yale)',
  sourceUrl: 'https://earlyretirementnow.com/2017/01/25/the-ultimate-guide-to-safe-withdrawal-rates-part-7-toolbox/',
  retrievedDate: '2026-03-15',
  values: [
${toEntriesCape(capePoints)}
  ],
};
`, 'utf8');
console.log(`Written: ${OUT_CAPE}`);

console.log('Done.');
