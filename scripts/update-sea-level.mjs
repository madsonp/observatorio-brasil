import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = 'https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&format=json';
const output = fileURLToPath(new URL('../data/sea-level.json', import.meta.url));

const response = await fetch(source);
if (!response.ok) throw new Error(`IOC/UNESCO respondeu ${response.status}`);
const rows = await response.json();
const stations = rows.filter(row => row.country === 'BRA');
if (!stations.length) throw new Error('Nenhuma estação brasileira encontrada.');

await mkdir(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
await writeFile(output, `${JSON.stringify({ source, generatedAt: new Date().toISOString(), stations }, null, 2)}\n`);
console.log(`Snapshot criado com ${stations.length} registros brasileiros.`);
