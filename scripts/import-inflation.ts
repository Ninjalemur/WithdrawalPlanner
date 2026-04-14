/**
 * import-inflation.ts
 *
 * Reads inflation data from two sources and writes monthly MonthlyDataSeries
 * TypeScript files.
 *
 * US CPI:
 *   Source: US Bureau of Labor Statistics — Historical CPI-U supplemental file
 *   URL: https://www.bls.gov/cpi/tables/supplemental-files/home.htm
 *   File: historical-cpi-u-202603.xlsx  (index page saved as US_inflation.csv)
 *   Format: Indent Level,Year,Jan.,Feb.,...,Dec.  (raw CPI index levels, base 1982-84=100)
 *   Method: YoY = level[year][month] / level[year-1][month] - 1
 *   Note: Oct 2025 absent (BLS appropriations lapse)
 *
 * Singapore CPI:
 *   Source: Singapore Department of Statistics — SingStat Table Builder (M213781)
 *   URL: https://tablebuilder.singstat.gov.sg/table/TS/M213781
 *   Title: "Percent Change In CPI Over Corresponding Period Of Previous Year"
 *   Format: wide time-series, dates as columns (newest first), "All Items" row, values in %
 *
 * Run: npx tsx scripts/import-inflation.ts
 */

import { readFileSync, writeFileSync } from 'fs';

interface Point { year: number; month: number; value: number }

// ---------------------------------------------------------------------------
// US: BLS CPI-U index levels → YoY rates
// ---------------------------------------------------------------------------

function parseBLSCpiLevels(csvPath: string): Point[] {
  const lines = readFileSync(csvPath, 'utf8').split('\n');

  // Find the header row (contains "Year" and "Jan")
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Year') && lines[i].toLowerCase().includes('jan')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error('US CSV: header row not found');

  // Build Map<year, Map<month(1-12), level>>
  const levels = new Map<number, Map<number, number>>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    // Row format: IndentLevel, Year, Jan, Feb, ..., Dec
    if (parseInt(cols[0]) !== 0) continue;
    const year = parseInt(cols[1]);
    if (isNaN(year)) continue;

    const monthMap = new Map<number, number>();
    for (let m = 0; m < 12; m++) {
      const raw = (cols[m + 2] ?? '').trim();
      if (!raw || raw === '?') continue;
      const level = parseFloat(raw);
      if (!isNaN(level)) monthMap.set(m + 1, level);
    }
    if (monthMap.size > 0) levels.set(year, monthMap);
  }

  // Compute YoY for each (year, month) where prior year's same month exists
  const points: Point[] = [];
  for (const [year, monthMap] of levels) {
    const prevYear = levels.get(year - 1);
    if (!prevYear) continue;
    for (const [month, level] of monthMap) {
      const prevLevel = prevYear.get(month);
      if (prevLevel === undefined) continue;
      points.push({ year, month, value: level / prevLevel - 1 });
    }
  }

  return points.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

// ---------------------------------------------------------------------------
// Singapore: SingStat TableBuilder wide-format YoY CPI
// ---------------------------------------------------------------------------

const SG_MONTH_MAP: Record<string, number> = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

function parseSingStatYoY(csvPath: string): Point[] {
  const lines = readFileSync(csvPath, 'utf8').split('\n');

  // Find the "Data Series" header row
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Data Series')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('SG CSV: "Data Series" header row not found');

  // Parse date columns: each header cell is "YYYY Mon " (with trailing space)
  const headerCols = lines[headerIdx].split(',');
  const dateCols: { year: number; month: number; colIdx: number }[] = [];
  for (let c = 1; c < headerCols.length; c++) {
    const cell = headerCols[c].trim();
    if (!cell) continue;
    const parts = cell.split(' ');
    if (parts.length < 2) continue;
    const year = parseInt(parts[0]);
    const month = SG_MONTH_MAP[parts[1].toLowerCase()];
    if (!isNaN(year) && month) dateCols.push({ year, month, colIdx: c });
  }

  // Find "All Items" data row (exact prefix match)
  let allItemsCols: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('All Items,') || line.startsWith('"All Items",')) {
      allItemsCols = line.split(',');
      break;
    }
  }
  if (allItemsCols.length === 0) throw new Error('SG CSV: "All Items" row not found');

  const points: Point[] = [];
  for (const { year, month, colIdx } of dateCols) {
    const raw = (allItemsCols[colIdx] ?? '').trim();
    if (!raw) continue;
    const pct = parseFloat(raw);
    if (isNaN(pct)) continue;
    points.push({ year, month, value: pct / 100 });
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
  console.log(`Written: ${outPath} (${points.length} months, ${first.year}-${String(first.month).padStart(2,'0')} through ${last.year}-${String(last.month).padStart(2,'0')})`);
}

// ---------------------------------------------------------------------------
// Singapore CPI
// ---------------------------------------------------------------------------

const sgPoints = parseSingStatYoY('g:/Downloads/Singapore_inflation.csv');

emitFile('src/data/raw/inflation/singapore.ts', sgPoints,
`import type { MonthlyDataSeries } from '../../types';

// Monthly Singapore CPI inflation rates, expressed as year-over-year (YoY) changes.
// value for (year, month) = CPI(year, month) / CPI(year-1, month) - 1
//
// Source: Singapore Department of Statistics — SingStat Table Builder
//   https://tablebuilder.singstat.gov.sg/table/TS/M213781
//   Table: "Percent Change In CPI Over Corresponding Period Of Previous Year, 2024 As Base Year, Monthly"
//   Series: All Items
// Retrieved: 2026-04-14
export const singaporeInflation: MonthlyDataSeries = {
  id: 'inflation-singapore',
  label: 'Singapore Inflation (CPI)',
  category: 'inflation',
  source: 'Singapore Department of Statistics',
  sourceUrl: 'https://tablebuilder.singstat.gov.sg/table/TS/M213781',
  retrievedDate: '2026-04-14',`);

// ---------------------------------------------------------------------------
// US CPI
// ---------------------------------------------------------------------------

const usPoints = parseBLSCpiLevels('g:/Downloads/US_inflation.csv');

emitFile('src/data/raw/inflation/us.ts', usPoints,
`import type { MonthlyDataSeries } from '../../types';

// Monthly US CPI inflation rates, expressed as year-over-year (YoY) changes.
// value for (year, month) = CPI(year, month) / CPI(year-1, month) - 1
// Derived from raw CPI-U index levels (base 1982-84=100).
// Note: Oct 2025 absent (BLS appropriations lapse).
//
// Source: US Bureau of Labor Statistics
//   https://www.bls.gov/cpi/tables/supplemental-files/home.htm
//   File: historical-cpi-u-202603.xlsx
// Retrieved: 2026-04-14
export const usInflation: MonthlyDataSeries = {
  id: 'inflation-us',
  label: 'US Inflation (CPI)',
  category: 'inflation',
  source: 'US Bureau of Labor Statistics',
  sourceUrl: 'https://www.bls.gov/cpi/tables/supplemental-files/home.htm',
  retrievedDate: '2026-04-14',`);

console.log('Done.');
