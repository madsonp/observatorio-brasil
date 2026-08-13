import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt';
const REFERENCE_URL = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/';
const OUTPUT_PATH = fileURLToPath(new URL('../data/roni.json', import.meta.url));

function parseRoniText(text) {
  const entries = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Z]{3})\s+(\d{4})\s+([\d.\-\s]+)$/);
    if (!match) continue;
    const [, season, year, numbers] = match;
    const values = numbers.trim().split(/\s+/).map(Number);
    const anomaly = values[values.length - 1];
    if (!Number.isFinite(anomaly)) continue;
    entries.push({ season, year: Number(year), anomaly });
  }
  return entries;
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`NOAA respondeu ${response.status} ao buscar ${SOURCE_URL}`);
  }
  const text = await response.text();
  const entries = parseRoniText(text);

  if (!entries.length) {
    throw new Error('Nenhum registro RONI foi encontrado no arquivo da NOAA. O formato pode ter mudado.');
  }

  const payload = {
    source: SOURCE_URL,
    reference: REFERENCE_URL,
    generatedAt: new Date().toISOString(),
    entries
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  const latest = entries[entries.length - 1];
  console.log(`RONI atualizado: ${entries.length} registros. Último: ${latest.season}/${latest.year} = ${latest.anomaly}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
