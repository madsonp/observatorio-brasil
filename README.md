# Observatório Brasil

Plataforma de monitoramento integrado de eventos ambientais utilizando dados públicos.

## Funcionalidades
- Mapa interativo
- Busca por cidade, estado e país
- Painel em cards
- Dados em tempo real do USGS
- Índice RONI (NOAA) para monitoramento do El Niño / La Niña no Pacífico
- Atualização automática

## Índice RONI (NOAA)
Em fevereiro de 2026 a NOAA (Climate Prediction Center) passou a usar o **RONI –
Relative Oceanic Niño Index** como índice oficial para monitorar o ENSO
(El Niño / La Niña), em substituição ao ONI tradicional. O RONI é a anomalia de
TSM (temperatura da superfície do mar) na região Niño 3.4, relativa à média dos
trópicos globais (20°N–20°S), em médias móveis trimestrais.

- Dados públicos: https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt
- Página oficial: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/
- Classificação: RONI ≥ 0,5 °C → El Niño · RONI ≤ -0,5 °C → La Niña · entre os dois → Neutro

Como o site é estático (GitHub Pages) e o arquivo da NOAA não expõe cabeçalhos
CORS para leitura via navegador, os dados são buscados e convertidos em
`data/roni.json` por uma GitHub Action (`.github/workflows/update-roni.yml`,
`scripts/update-roni.mjs`), executada diariamente e sob demanda. O `app.js`
lê esse JSON local (mesma origem) e exibe o painel "Índice RONI" no topo da
página. Para atualizar manualmente, rode `node scripts/update-roni.mjs` com
acesso à internet.

## Estrutura
```
index.html
app.js
styles.css (referenciado; ainda não versionado no repositório)
data/roni.json
scripts/update-roni.mjs
.github/workflows/update-roni.yml
README.md
```

## Como executar

### VS Code (recomendado)
1. Abra a pasta do projeto.
2. Instale a extensão Live Server.
3. Clique com o botão direito em `index.html`.
4. Escolha **Open with Live Server**.

### Python
```bash
python -m http.server 8000
```
Acesse: http://localhost:8000

### Node.js
```bash
npx serve
```

## GitHub Pages
Após alterações:
```bash
git add .
git commit -m "Atualização"
git push origin main
```
Se o GitHub Pages estiver habilitado, a publicação será automática.

## Roadmap
- INPE
- ANA
- Cemaden
- Meteorologia
- Qualidade do ar
- Satélites
- IA para análise territorial