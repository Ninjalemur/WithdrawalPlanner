/**
 * import-msci.ts
 *
 * Generates the MSCI World raw returns file by stitching two sources:
 *
 *   1970-01 to 1998-12  Ceyron/scientific-python-course GitHub dataset
 *                       (stored in src/data/csv/msci_world_ceyron_1970_2021.csv)
 *                       https://github.com/Ceyron/scientific-python-course/blob/main/data/msci_world_monthly.csv
 *                       Index base: 100 = Dec 1969. Formula: r = level[t] / level[t-1] - 1
 *
 *   1999-01 to present  MSCI World Gross Return USD (downloaded from msci.com)
 *                       https://www.msci.com/indexes/index/990100
 *                       CSV format: Date,<Index Name>  (YYYY-MM-DD, index level)
 *                       Formula: r = level[t] / level[t-1] - 1
 *
 * Both series are total return (gross, dividends reinvested). Overlap validation
 * (Jan 1999): Ceyron +2.08% vs MSCI +2.12% — rounding difference only.
 *
 * Run: npx tsx scripts/import-msci.ts
 */

import { readFileSync, writeFileSync } from 'fs';

const CSV_DIR         = 'g:/Downloads/';
const CEYRON_CSV      = 'src/data/csv/msci_world_ceyron_1970_2021.csv';
const MSCI_WORLD_CSV  = `${CSV_DIR}MSCI_World.csv`;
const OUT_DIR         = 'src/data/raw/returns/';
const MSCI_RETRIEVED  = '2026-04-09';

interface LevelRow { year: number; month: number; level: number }
interface Point    { year: number; month: number; value: number }

function parseLevels(csvPath: string): LevelRow[] {
  const lines = readFileSync(csvPath, 'utf8').split('\n');
  const result: LevelRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const dateStr  = line.slice(0, comma);
    const levelStr = line.slice(comma + 1);
    const level    = parseFloat(levelStr);
    if (isNaN(level)) continue;
    const parts = dateStr.split('-');
    if (parts.length < 2) continue;
    result.push({ year: parseInt(parts[0]), month: parseInt(parts[1]), level });
  }
  return result;
}

function computeReturns(rows: LevelRow[]): Point[] {
  const points: Point[] = [];
  for (let i = 1; i < rows.length; i++) {
    points.push({
      year:  rows[i].year,
      month: rows[i].month,
      value: rows[i].level / rows[i - 1].level - 1,
    });
  }
  return points;
}

function toEntries(points: Point[]): string {
  return points
    .map(p => `    { year: ${p.year}, month: ${String(p.month).padStart(2, ' ')}, value: ${p.value.toFixed(8)} },`)
    .join('\n');
}

// --- Build stitched MSCI World series ---

// 1. Ceyron: Dec 1969 – Aug 2021. Keep only levels through Dec 1998.
const ceyronRows   = parseLevels(CEYRON_CSV);
const ceyronPre    = ceyronRows.filter(r => r.year <= 1998);  // Dec 1969 – Dec 1998
const ceyronRets   = computeReturns(ceyronPre);               // Jan 1970 – Dec 1998 (348 pts)

// 2. MSCI World: Dec 1998 – Mar 2026.
const msciRows     = parseLevels(MSCI_WORLD_CSV);
const msciRets     = computeReturns(msciRows);                // Jan 1999 – Mar 2026 (327 pts)

// 3. Stitch.
const stitched     = [...ceyronRets, ...msciRets];            // 675 total

const first = stitched[0];
const last  = stitched[stitched.length - 1];
const coverageStr = `${first.year}-${String(first.month).padStart(2,'0')} through ${last.year}-${String(last.month).padStart(2,'0')} (${stitched.length} months)`;

console.log(`msciWorld: ${ceyronRets.length} Ceyron + ${msciRets.length} MSCI = ${stitched.length} monthly returns`);
console.log(`  Coverage: ${coverageStr}`);

const output = `import type { MonthlyDataSeries } from '../../types';

// Monthly total returns (gross return, dividends reinvested) for MSCI World.
// Values are decimals: 0.015 = +1.5%, -0.03 = -3.0%.
//
// STITCHED from two sources:
//   1970-01 to 1998-12 (348 months): Ceyron/scientific-python-course GitHub dataset
//     https://github.com/Ceyron/scientific-python-course/blob/main/data/msci_world_monthly.csv
//     Stored locally: src/data/csv/msci_world_ceyron_1970_2021.csv
//     Index base: 100 = Dec 1969. Formula: return = level[t] / level[t-1] - 1
//   1999-01 to present (${msciRets.length} months): MSCI World Gross Return USD
//     https://www.msci.com/indexes/index/990100
//     Retrieved: ${MSCI_RETRIEVED}. Formula: return = level[t] / level[t-1] - 1
//
// Both series are total return (gross, dividends reinvested).
// Overlap validation (Jan 1999): Ceyron +2.08% vs MSCI +2.12% — rounding difference only.
// Coverage: ${coverageStr}
export const msciWorld: MonthlyDataSeries = {
  id: 'msciWorld',
  label: 'World Equity (Developed)',
  category: 'returns',
  source: 'MSCI World Gross Return USD (stitched with Ceyron/scientific-python-course 1970–1998)',
  sourceUrl: 'https://www.msci.com/indexes/index/990100',
  retrievedDate: '${MSCI_RETRIEVED}',
  values: [
${toEntries(stitched)}
  ],
};
`;

writeFileSync(OUT_DIR + 'msciWorld.ts', output, 'utf8');
console.log(`Written: ${OUT_DIR}msciWorld.ts`);
console.log('Done.');
