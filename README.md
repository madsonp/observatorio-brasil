# Observatório Brasil

Plataforma estática de monitoramento integrado de eventos ambientais no Brasil. Versão atual: **0.2.0**.

## Funcionalidades

- Terremotos do USGS: últimas 24 horas no mundo e últimos 7 dias na região do Brasil.
- Estações maregráficas brasileiras da IOC/UNESCO, com leitura recente, tendência estimada e extremos observados em 12 horas.
- Camadas independentes de terremotos, marés e alertas oficiais CAP.
- Alerta pessoal no navegador para comunicados oficiais de tsunami ou maremoto no Brasil.
- Previsões de risco geo-hidrológico do Cemaden, associadas às malhas territoriais do IBGE.
- Histórico das previsões do Cemaden, consultável por data no mapa.
- Índice RONI da NOAA para monitoramento de El Niño, La Niña e condição neutra.
- Busca territorial por cidade, estado ou país.

## Fontes e interpretação

### USGS — terremotos

O mapa consome o feed GeoJSON semanal do USGS. A visão global é filtrada para as últimas 24 horas; a visão regional utiliza os últimos 7 dias.

- Feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson

### IOC/UNESCO — nível do mar

As estações brasileiras são obtidas do Sea Level Station Monitoring Facility. Como o catálogo global possui aproximadamente 2 MB, `data/sea-level.json` funciona como snapshot local para a primeira renderização; a consulta ao vivo é executada em segundo plano.

O valor exibido é uma leitura bruta relativa ao datum local da estação. Ele não corresponde necessariamente ao nível médio do mar e não deve ser comparado diretamente entre estações. A indicação de maré enchendo, vazando, alta ou baixa é uma estimativa calculada com as últimas 12 horas, não uma previsão oficial de preamar ou baixamar.

- Serviço: https://www.ioc-sealevelmonitoring.org/
- Atualização manual: `node scripts/update-sea-level.mjs`

### Alertas CAP e tsunami

Alertas brasileiros são consultados em uma camada CAP agregada em tempo quase real. A notificação pessoal dispara somente quando um comunicado oficial contém “tsunami” ou “maremoto”. Terremotos e oscilações maregráficas isoladas não geram alerta de tsunami.

As notificações funcionam enquanto a página está aberta e após autorização explícita do navegador.

- Ponto focal brasileiro: https://tsunami.ioc.unesco.org/en/memeber-states/br
- Registro CAP da autoridade brasileira: https://alertingauthority.wmo.int/authorities.php?memberCode=BR

### Cemaden e IBGE — riscos geo-hidrológicos

`scripts/update-cemaden-risk.mjs` localiza o boletim mais recente do Cemaden, extrai data, tipo e nível de risco, resolve as regiões geográficas intermediárias no cadastro do IBGE e baixa suas geometrias oficiais. Os resultados são publicados em:

- `data/cemaden-risk.json`: previsão atual;
- `data/cemaden-risk-history.json`: até 365 registros históricos.

Quando o boletim declara ausência de risco significativo, o mapa não inventa polígonos nem classifica automaticamente a situação. Para executar manualmente:

```bash
node scripts/update-cemaden-risk.mjs
```

Também é possível arquivar uma página específica antes de restaurar o boletim atual:

```bash
node scripts/update-cemaden-risk.mjs "URL_DO_BOLETIM"
node scripts/update-cemaden-risk.mjs
```

### NOAA — índice RONI

O RONI é a anomalia de temperatura da superfície do mar na região Niño 3.4 relativa à média dos trópicos globais, em médias móveis trimestrais.

- RONI ≥ 0,5 °C: El Niño.
- RONI ≤ −0,5 °C: La Niña.
- Entre os limiares: neutro.
- Dados: https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt
- Atualização manual: `node scripts/update-roni.mjs`

## Atualização automática

O workflow `.github/workflows/update-roni.yml` executa diariamente às 13:00 UTC e também pode ser acionado manualmente. Ele atualiza:

- `data/roni.json`;
- `data/sea-level.json`;
- `data/cemaden-risk.json`;
- `data/cemaden-risk-history.json`.

Quando há alterações, o GitHub Actions cria e envia um commit usando `github-actions[bot]`.

## Estrutura

```text
.github/workflows/update-roni.yml
data/
  cemaden-risk-history.json
  cemaden-risk.json
  roni.json
  sea-level.json
scripts/
  update-cemaden-risk.mjs
  update-roni.mjs
  update-sea-level.mjs
app.js
index.html
styles.css
VERSION
```

## Execução local

O projeto não possui etapa de compilação. Inicie um servidor HTTP na raiz:

```bash
python -m http.server 8000
```

Acesse http://localhost:8000. Abrir `index.html` diretamente pelo sistema de arquivos não é recomendado porque os arquivos JSON são carregados por `fetch`.

## Limitações de segurança

- O painel é informativo e não substitui alertas da Defesa Civil, Cemaden ou Cenad.
- Dados operacionais podem apresentar atraso, falhas ou ausência de controle de qualidade em tempo real.
- Não use o painel isoladamente para decisões de evacuação ou navegação.

## Versionamento

O projeto segue versionamento semântico. A versão também está registrada no arquivo `VERSION` e no rodapé da aplicação.
