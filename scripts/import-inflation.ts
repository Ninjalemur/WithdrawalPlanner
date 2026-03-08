/**
 * import-inflation.ts
 *
 * Reads pivoted inflation CSVs (rows = years, columns = months, values = YoY%)
 * and writes monthly MonthlyDataSeries TypeScript files.
 *
 * Partial years (e.g. 2026 with only Jan filled) are excluded entirely.
 * Empty cells are skipped.
 *
 * Run: npx tsx scripts/import-inflation.ts
 */

import { readFileSync, writeFileSync } from 'fs';

const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// ---------------------------------------------------------------------------
// Parser: pivoted CSV → sorted monthly points
// ---------------------------------------------------------------------------

interface Point { year: number; month: number; value: number }

function parsePivotedCsv(csvPath: string, excludePartialYears = true): Point[] {
  const lines = readFileSync(csvPath, 'utf8').split('\n');
  const points: Point[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    const year = parseInt(cols[0]);
    if (isNaN(year)) continue;

    const monthValues: (number | null)[] = [];
    for (let m = 0; m < 12; m++) {
      const raw = (cols[m + 1] ?? '').trim().replace('%', '');
      monthValues.push(raw === '' ? null : parseFloat(raw) / 100);
    }

    // Skip years where December is null — those are genuinely partial/trailing years.
    // Mid-year gaps (e.g. a single missing month) are kept; the missing month is simply omitted.
    if (excludePartialYears && monthValues[11] === null) continue;

    for (let m = 0; m < 12; m++) {
      const v = monthValues[m];
      if (v !== null) points.push({ year, month: m + 1, value: v });
    }
  }

  return points.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

function emitFile(outPath: string, points: Point[], header: string) {
  const first = points[0], last = points[points.length - 1];
  const entries = points
    .map(p => `    { year: ${p.year}, month: ${String(p.month).padStart(2,' ')}, value: ${p.value.toFixed(8)} },`)
    .join('\n');

  writeFileSync(outPath, `${header}
// Coverage: ${first.year}-${String(first.month).padStart(2,'0')} through ${last.year}-${String(last.month).padStart(2,'0')} (${points.length} months)
  values: [
${entries}
  ],
};
`, 'utf8');
  console.log(`Written: ${outPath} (${points.length} months, ${first.year}-${first.month} through ${last.year}-${last.month})`);
}

// ---------------------------------------------------------------------------
// Singapore CPI
// ---------------------------------------------------------------------------

const sgPoints = parsePivotedCsv('g:/Downloads/Singapore_inflation.csv');

emitFile('src/data/raw/inflation/singapore.ts', sgPoints,
`import type { MonthlyDataSeries } from '../../types';

// Monthly Singapore CPI inflation rates, expressed as year-over-year (YoY) changes.
// value for (year, month) = CPI(year, month) / CPI(year-1, month) - 1
//
// Source: Singapore Department of Statistics
//   https://www.singstat.gov.sg/find-data/search-by-theme/prices-and-price-indices/consumer-price-indices/latest-data
// Retrieved: 2026-03-08
export const singaporeInflation: MonthlyDataSeries = {
  id: 'inflation-singapore',
  label: 'Singapore Inflation (CPI)',
  category: 'inflation',
  source: 'Singapore Department of Statistics',
  sourceUrl: 'https://www.singstat.gov.sg/find-data/search-by-theme/prices-and-price-indices/consumer-price-indices/latest-data',
  retrievedDate: '2026-03-08',`);

// ---------------------------------------------------------------------------
// US CPI
// ---------------------------------------------------------------------------

const usPoints = parsePivotedCsv('g:/Downloads/US_inflation.csv');

emitFile('src/data/raw/inflation/us.ts', usPoints,
`import type { MonthlyDataSeries } from '../../types';

// Monthly US CPI inflation rates, expressed as year-over-year (YoY) changes.
// value for (year, month) = CPI(year, month) / CPI(year-1, month) - 1
//
// Source: US Bureau of Labor Statistics
//   https://www.bls.gov/cpi/
// Retrieved: 2026-03-08
export const usInflation: MonthlyDataSeries = {
  id: 'inflation-us',
  label: 'US Inflation (CPI)',
  category: 'inflation',
  source: 'US Bureau of Labor Statistics',
  sourceUrl: 'https://www.bls.gov/cpi/',
  retrievedDate: '2026-03-08',`);

console.log('Done.');
