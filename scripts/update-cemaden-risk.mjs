import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const INDEX_URL = 'https://www.gov.br/cemaden/pt-br/assuntos/riscos-geo-hidrologicos/';
const IBGE_REGIONS_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/regioes-intermediarias';
const OUTPUT_PATH = fileURLToPath(new URL('../data/cemaden-risk.json', import.meta.url));
const HISTORY_PATH = fileURLToPath(new URL('../data/cemaden-risk-history.json', import.meta.url));

const decodeHtml = value => value
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const plainText = html => decodeHtml(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')).trim();

const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

async function getText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'ObservatorioBrasil/1.0' } });
  if (!response.ok) throw new Error(`${url} respondeu ${response.status}`);
  return response.text();
}

function findLatestBulletin(indexHtml) {
  const links = [...indexHtml.matchAll(/href="([^"]*previsao-de-riscos-geo-hidrologicos[^"]*)"/gi)]
    .map(match => new URL(decodeHtml(match[1]), INDEX_URL).href)
    .filter(url => /\/\d{2}-\d{2}-\d{4}-previsao-de-riscos-geo-hidrologic[oa]s?(?:-\d+)?\/?$/i.test(url));
  if (!links.length) throw new Error('Nenhum boletim diário foi encontrado no índice do Cemaden.');
  return links[0];
}

function section(text, start, end) {
  const from = text.search(start);
  if (from < 0) return '';
  const rest = text.slice(from);
  const to = rest.slice(1).search(end);
  return to < 0 ? rest : rest.slice(0, to + 1);
}

function riskLevel(text) {
  if (/MUITO\s+ALT[AO]/i.test(text)) return 'very-high';
  if (/\bALT[AO]\b/i.test(text)) return 'high';
  if (/MODERAD[AO]/i.test(text)) return 'moderate';
  if (/\bBAIX[AO]\b/i.test(text)) return 'low';
  return null;
}

function regionNames(text) {
  const names = [];
  const pattern = /Regi(?:ão|ões) Geográfica(?:s)? Intermediária(?:s)? (?:de|do|da|indicadas?[^:]*:)?\s*([^.;]+)/gi;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[1].replace(/\([^)]*\)/g, '').replace(/\s+e\s+.*$/i, '').trim();
    if (candidate && normalize(candidate) !== 'indicadas' && candidate.length < 80) names.push(candidate);
  }
  return [...new Set(names)];
}

async function geometryFor(region) {
  const url = `https://servicodados.ibge.gov.br/api/v4/malhas/regioes-intermediarias/${region.id}?formato=application/vnd.geo+json&qualidade=minima`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`IBGE respondeu ${response.status} para ${region.nome}`);
  const collection = await response.json();
  return collection.features?.[0]?.geometry || null;
}

const indexHtml = await getText(INDEX_URL);
const source = process.argv[2] || findLatestBulletin(indexHtml);
const articleHtml = await getText(source);
const text = plainText(articleHtml);
const regions = await fetch(IBGE_REGIONS_URL).then(response => response.json());
const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\s*-?\s*Previsão de Riscos Geo-Hidrológicos/i)
  || source.match(/(\d{2})-(\d{2})-(\d{4})/);
const validFor = dateMatch?.[3] ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
  : dateMatch ? dateMatch[1].split('/').reverse().join('-') : null;

const blocks = [
  ['hydrological', section(text, /Risco Hidrológico/i, /Risco Geológico/i)],
  ['geological', section(text, /Risco Geológico/i, /Figura\s+2|Compartilhe|Assuntos/i)]
];
const features = [];

for (const [type, block] of blocks) {
  const level = riskLevel(block);
  if (!level || /não há cenário de risco significativo/i.test(block)) continue;
  for (const name of regionNames(block)) {
    const region = regions.find(item => normalize(item.nome) === normalize(name));
    if (!region) {
      console.warn(`Região não reconhecida pelo IBGE: ${name}`);
      continue;
    }
    const geometry = await geometryFor(region);
    if (!geometry) continue;
    features.push({
      type: 'Feature',
      geometry,
      properties: {
        id: String(region.id),
        name: region.nome,
        state: region['UF']?.sigla || '',
        riskType: type,
        level
      }
    });
  }
}

const payload = {
  source,
  generatedAt: new Date().toISOString(),
  validFor,
  summaries: {
    hydrological: blocks[0][1],
    geological: blocks[1][1]
  },
  featureCollection: { type: 'FeatureCollection', features }
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
let history = [];
try {
  history = JSON.parse(await readFile(HISTORY_PATH, 'utf8')).records || [];
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
history = [payload, ...history.filter(record => record.source !== payload.source)]
  .sort((a, b) => String(b.validFor || '').localeCompare(String(a.validFor || '')))
  .slice(0, 365);
await writeFile(HISTORY_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), records: history }, null, 2)}\n`);
console.log(`Previsão Cemaden atualizada: ${features.length} região(ões), válida para ${validFor || 'data não identificada'}.`);
