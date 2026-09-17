const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const RONI_DATA_URL = 'data/roni.json';
const SEA_LEVEL_URL = 'https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&format=json';
const SEA_LEVEL_CACHE_URL = 'data/sea-level.json';
const CAP_ALERTS_URL = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/CAP_Alerts_Feed/FeatureServer/0/query?f=geojson&where=countryCode%3D%27br%27&outFields=identifier%2Cevent%2Cheadline%2Cseverity%2Curgency%2Ccertainty%2CareaDesc%2Cexpires%2Csent%2CsenderName%2Cweb%2CcountryCode&returnGeometry=true';
const CEMADEN_RISK_DATA_URL = 'data/cemaden-risk.json';
const CEMADEN_RISK_HISTORY_URL = 'data/cemaden-risk-history.json';
const RONI_THRESHOLD = 0.5;
const GLOBAL_PERIOD_MS = 24 * 60 * 60 * 1000;
const SEA_RECENT_MS = 3 * 60 * 60 * 1000;

const BRAZIL_BOUNDS = { south: -33.8, north: 5.3, west: -74, east: -34.8 };

const state = {
  features: [],
  filtered: [],
  selectedLocation: null,
  selectedEvents: [],
  loading: false
};

const map = L.map('map', { zoomControl: true }).setView([-14.2, -51.9], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const seaLevelLayer = L.layerGroup().addTo(map);
const alertLayer = L.geoJSON(null).addTo(map);
const riskLayer = L.geoJSON(null).addTo(map);
let selectedBoundsLayer = null;
let cemadenRiskForecast = null;
let cemadenRiskHistory = [];
let activeRiskMode = 'hydrological';

const el = id => document.getElementById(id);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

function magnitudeOf(feature) {
  const mag = Number(feature.properties.mag);
  return Number.isFinite(mag) ? mag : 0;
}

function depthOf(feature) {
  const depth = Number(feature.geometry.coordinates[2]);
  return Number.isFinite(depth) ? depth : 0;
}

function placeOf(feature) {
  return feature.properties.place || 'Local não informado';
}

const SEVERITY_LABELS = { low: 'Baixa', moderate: 'Moderada', high: 'Alta', critical: 'Crítica' };

function severity(mag) {
  const key = mag >= 6 ? 'critical' : mag >= 4.5 ? 'high' : mag >= 2.5 ? 'moderate' : 'low';
  return { key, label: SEVERITY_LABELS[key] };
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short'
  }).format(new Date(value));
}

function relativeTime(value) {
  const diffMinutes = Math.round(Math.max(Date.now() - value, 0) / 60000);
  if (diffMinutes < 60) return `${Math.max(diffMinutes, 1)} min`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function pointInsideBounds(feature, bounds) {
  const [lon, lat] = feature.geometry.coordinates;
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

function isBrazilRegion(feature) {
  return pointInsideBounds(feature, BRAZIL_BOUNDS);
}

function renderMap() {
  markerLayer.clearLayers();
  const minMag = Number(el('magnitude').value);
  const brazilOnly = el('brazil-only').checked;
  const globalCutoff = Date.now() - GLOBAL_PERIOD_MS;

  state.filtered = state.features.filter(feature => {
    const insidePeriod = brazilOnly || feature.properties.time >= globalCutoff;
    return insidePeriod && magnitudeOf(feature) >= minMag && (!brazilOnly || isBrazilRegion(feature));
  });

  state.filtered.forEach(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    const mag = magnitudeOf(feature);
    const sev = severity(mag);
    const marker = L.circleMarker([lat, lon], {
      radius: Math.max(5, Math.min(15, mag * 2)),
      className: `quake-marker ${sev.key}`,
      fillOpacity: 0.8,
      weight: 1
    }).bindPopup(`
      <strong>${escapeHtml(placeOf(feature))}</strong><br>
      Magnitude: ${mag.toFixed(1)}<br>
      Profundidade: ${depthOf(feature).toFixed(1)} km<br>
      ${escapeHtml(formatDate(feature.properties.time))}
    `);
    markerLayer.addLayer(marker);
  });

  const maxMag = state.filtered.length
    ? Math.max(...state.filtered.map(magnitudeOf)).toFixed(1)
    : '—';

  el('count').textContent = state.filtered.length;
  el('side-count').textContent = state.filtered.length;
  el('max-mag').textContent = maxMag;
  el('events-title').textContent = brazilOnly
    ? 'Eventos recentes · últimos 7 dias'
    : 'Eventos recentes · últimas 24 horas';
  renderEventList(el('events'), state.filtered.slice(0, 50));
}

function syncMapLayers() {
  const layers = [
    [markerLayer, el('show-quakes').checked],
    [seaLevelLayer, el('show-sea-level').checked],
    [alertLayer, el('show-alerts').checked]
  ];
  layers.forEach(([layer, visible]) => {
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
  });
}

function createRiskInterface() {
  const control = L.control({ position: 'topright' });
  control.onAdd = () => {
    const container = L.DomUtil.create('section', 'risk-map-control');
    container.innerHTML = `
      <div class="risk-control-heading">
        <span>PREVISÃO CEMADEN</span>
        <strong>Riscos Geo-Hidrológicos</strong>
        <small id="risk-validity">Carregando validade…</small>
      </div>
      <div class="risk-mode-switch" role="group" aria-label="Tipo de risco">
        <button class="active" type="button" data-risk-mode="hydrological">💧 Hidrológico</button>
        <button type="button" data-risk-mode="geological">⛰ Geológico</button>
      </div>
      <label class="risk-history-label" for="risk-history-select">Histórico</label>
      <select id="risk-history-select" class="risk-history-select" aria-label="Data da previsão" disabled>
        <option>Carregando…</option>
      </select>
      <div id="risk-map-summary" class="risk-map-summary">Carregando previsão…</div>
      <a id="risk-source" href="https://www.gov.br/cemaden/pt-br/assuntos/riscos-geo-hidrologicos/" target="_blank" rel="noopener">Boletim oficial ↗</a>
    `;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    container.querySelectorAll('[data-risk-mode]').forEach(button => {
      button.addEventListener('click', () => {
        container.querySelectorAll('[data-risk-mode]').forEach(item => item.classList.toggle('active', item === button));
        activeRiskMode = button.dataset.riskMode;
        renderCemadenRisk(button.dataset.riskMode);
      });
    });
    container.querySelector('#risk-history-select').addEventListener('change', event => {
      cemadenRiskForecast = cemadenRiskHistory[Number(event.target.value)];
      updateRiskMetadata();
      renderCemadenRisk(activeRiskMode);
    });
    return container;
  };
  control.addTo(map);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const container = L.DomUtil.create('div', 'risk-legend');
    container.innerHTML = `
      <strong>Possibilidade de risco</strong>
      <span><i class="very-high"></i>Muito alto</span>
      <span><i class="high"></i>Alto</span>
      <span><i class="moderate"></i>Moderado</span>
      <span><i class="low"></i>Baixo</span>
    `;
    L.DomEvent.disableClickPropagation(container);
    return container;
  };
  legend.addTo(map);
}

function updateRiskMetadata() {
  if (!cemadenRiskForecast) return;
  const validity = cemadenRiskForecast.validFor
    ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${cemadenRiskForecast.validFor}T12:00:00`))
    : 'não informada';
  document.getElementById('risk-validity').textContent = `Válida para ${validity}`;
  document.getElementById('risk-source').href = cemadenRiskForecast.source;
}

function renderCemadenRisk(mode) {
  riskLayer.clearLayers();
  const summary = document.getElementById('risk-map-summary');
  if (!summary) return;
  if (!cemadenRiskForecast) {
    summary.textContent = 'Carregando previsão…';
    return;
  }
  const features = cemadenRiskForecast.featureCollection.features.filter(feature => feature.properties.riskType === mode);
  if (!features.length) {
    summary.innerHTML = `<strong>Sem risco significativo</strong><small>${mode === 'hydrological' ? 'Eventos hidrológicos' : 'Movimentos de massa'}</small>`;
    return;
  }
  const colors = {
    'very-high': ['#991b1b', '#ed0000'], high: ['#9a3412', '#ff8100'],
    moderate: ['#b45309', '#fde300'], low: ['#64748b', '#ffffff']
  };
  const labels = { 'very-high': 'Muito alto', high: 'Alto', moderate: 'Moderado', low: 'Baixo' };
  riskLayer.addData({ type: 'FeatureCollection', features });
  riskLayer.eachLayer(layer => {
    const item = layer.feature.properties;
    const [color, fillColor] = colors[item.level] || colors.low;
    layer.setStyle({ color, fillColor, fillOpacity: 0.68, weight: 2 });
    layer.bindPopup(`
      <strong>${mode === 'hydrological' ? '💧' : '⛰'} Risco ${escapeHtml(labels[item.level] || item.level)}</strong><br>
      ${escapeHtml(item.name)}${item.state ? ` (${escapeHtml(item.state)})` : ''}<br>
      <a href="${escapeHtml(cemadenRiskForecast.source)}" target="_blank" rel="noopener">Boletim Cemaden ↗</a>
    `);
    layer.bringToBack?.();
  });
  const levels = features.map(feature => labels[feature.properties.level] || feature.properties.level);
  summary.innerHTML = `<strong>${escapeHtml([...new Set(levels)].join(', '))}</strong><small>${features.length} região(ões) indicada(s)</small>`;
}

async function loadCemadenRisk() {
  try {
    const [currentResponse, historyResponse] = await Promise.all([
      fetch(CEMADEN_RISK_DATA_URL, { cache: 'no-store' }),
      fetch(CEMADEN_RISK_HISTORY_URL, { cache: 'no-store' })
    ]);
    if (!currentResponse.ok) throw new Error(`Dados locais responderam ${currentResponse.status}`);
    cemadenRiskForecast = await currentResponse.json();
    cemadenRiskHistory = historyResponse.ok
      ? (await historyResponse.json()).records || []
      : [cemadenRiskForecast];
    if (!cemadenRiskHistory.length) cemadenRiskHistory = [cemadenRiskForecast];
    const select = document.getElementById('risk-history-select');
    select.innerHTML = cemadenRiskHistory.map((record, index) => {
      const label = record.validFor
        ? new Intl.DateTimeFormat('pt-BR').format(new Date(`${record.validFor}T12:00:00`))
        : `Registro ${index + 1}`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    }).join('');
    select.disabled = cemadenRiskHistory.length < 2;
    const currentIndex = cemadenRiskHistory.findIndex(record => record.source === cemadenRiskForecast.source);
    select.value = String(Math.max(currentIndex, 0));
    updateRiskMetadata();
    renderCemadenRisk(activeRiskMode);
  } catch (error) {
    const summary = document.getElementById('risk-map-summary');
    if (summary) summary.textContent = `Previsão indisponível: ${error.message}`;
  }
}

function renderEventList(container, features) {
  if (!features.length) {
    container.innerHTML = '<div class="empty-state">Nenhum evento encontrado para os filtros atuais.</div>';
    return;
  }

  container.innerHTML = features.map(feature => {
    const mag = magnitudeOf(feature);
    const sev = severity(mag);
    return `
      <article class="event-card">
        <div class="event-mag ${sev.key}">${mag.toFixed(1)}</div>
        <div>
          <strong>${escapeHtml(placeOf(feature))}</strong>
          <span>${sev.label} • ${depthOf(feature).toFixed(1)} km de profundidade</span>
          <small>${escapeHtml(formatDate(feature.properties.time))} • há ${relativeTime(feature.properties.time)}</small>
        </div>
      </article>`;
  }).join('');
}

async function loadData() {
  if (state.loading) return;
  state.loading = true;
  el('refresh').disabled = true;
  el('refresh').textContent = 'Atualizando…';
  el('error').hidden = true;
  try {
    const response = await fetch(USGS_URL);
    if (!response.ok) throw new Error(`Falha na fonte USGS (${response.status})`);
    const data = await response.json();
    state.features = (data.features || []).sort((a, b) => b.properties.time - a.properties.time);
    el('updated').textContent = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit'
    }).format(new Date());
    renderMap();
    if (state.selectedLocation) renderLocationDashboard(state.selectedLocation);
  } catch (error) {
    el('error').hidden = false;
    el('error').textContent = `Não foi possível carregar os dados: ${error.message}`;
  } finally {
    state.loading = false;
    el('refresh').disabled = false;
    el('refresh').textContent = 'Atualizar dados';
  }
}

function classifyRoni(anomaly) {
  if (anomaly >= RONI_THRESHOLD) return { key: 'nino', label: 'El Niño' };
  if (anomaly <= -RONI_THRESHOLD) return { key: 'nina', label: 'La Niña' };
  return { key: 'neutral', label: 'Neutro' };
}

async function loadRoni() {
  const errorBox = el('roni-error');
  errorBox.hidden = true;
  try {
    const response = await fetch(RONI_DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao carregar dados RONI (${response.status})`);
    const payload = await response.json();
    const entries = payload.entries || [];

    if (!entries.length) {
      el('roni-value').textContent = '—';
      el('roni-season').textContent = 'Aguardando primeira sincronização automática';
      el('roni-phase-badge').textContent = '—';
      el('roni-phase-badge').className = 'roni-badge neutral';
      el('roni-trend-list').innerHTML = '';
      el('roni-updated').textContent = '';
      return;
    }

    const latest = entries[entries.length - 1];
    const phase = classifyRoni(latest.anomaly);

    el('roni-value').textContent = `${latest.anomaly > 0 ? '+' : ''}${latest.anomaly.toFixed(2)} °C`;
    el('roni-season').textContent = `Trimestre ${latest.season}/${latest.year}`;

    const badge = el('roni-phase-badge');
    badge.textContent = phase.label;
    badge.className = `roni-badge ${phase.key}`;

    const recent = entries.slice(-6);
    el('roni-trend-list').innerHTML = recent.map(entry => {
      const p = classifyRoni(entry.anomaly);
      return `
        <div class="roni-trend-item ${p.key}">
          <span>${entry.season}/${entry.year}</span>
          <strong>${entry.anomaly.toFixed(2)}</strong>
        </div>`;
    }).join('');

    el('roni-updated').textContent = payload.generatedAt
      ? `Atualizado em ${formatDate(payload.generatedAt)} • Dados públicos da NOAA CPC`
      : 'Dados públicos da NOAA CPC';
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = `Não foi possível carregar o índice RONI: ${error.message}`;
  }
}

function parseUtcDate(value) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.trim().replace(' ', 'T');
  const date = new Date(`${normalized.replace(/Z$/, '')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tideState(readings) {
  const values = readings.map(reading => reading.value);
  const minimum = readings.reduce((best, reading) => reading.value < best.value ? reading : best);
  const maximum = readings.reduce((best, reading) => reading.value > best.value ? reading : best);
  const sampleSize = Math.min(10, Math.floor(readings.length / 2));
  const earlier = values.slice(-sampleSize * 2, -sampleSize);
  const recent = values.slice(-sampleSize);
  const average = items => items.reduce((sum, value) => sum + value, 0) / items.length;
  const change = average(recent) - average(earlier);
  const current = values[values.length - 1];
  const range = maximum.value - minimum.value;
  const position = range ? (current - minimum.value) / range : 0.5;

  let label = 'Estável';
  let icon = '↔';
  if (change >= 0.015) label = position >= 0.8
    ? 'Enchendo · próxima da alta'
    : position <= 0.2 ? 'Enchendo · após baixa' : 'Enchendo';
  if (change <= -0.015) label = position <= 0.2
    ? 'Vazando · próxima da baixa'
    : position >= 0.8 ? 'Vazando · após alta' : 'Vazando';
  if (change >= 0.015) icon = '↗';
  if (change <= -0.015) icon = '↘';
  if (Math.abs(change) < 0.015 && position >= 0.8) label = 'Maré alta';
  if (Math.abs(change) < 0.015 && position <= 0.2) label = 'Maré baixa';
  return { label, icon, minimum, maximum, change };
}

function keepPopupInsideViewport(marker) {
  const popupElement = marker.getPopup()?.getElement();
  if (!popupElement) return;
  const mapRect = map.getContainer().getBoundingClientRect();
  const popupRect = popupElement.getBoundingClientRect();
  const padding = 16;
  const visible = {
    left: Math.max(mapRect.left, 0) + padding,
    top: Math.max(mapRect.top, 0) + padding,
    right: Math.min(mapRect.right, window.innerWidth) - padding,
    bottom: Math.min(mapRect.bottom, window.innerHeight) - padding
  };
  let x = 0;
  let y = 0;
  if (popupRect.left < visible.left) x = popupRect.left - visible.left;
  if (popupRect.right > visible.right) x = popupRect.right - visible.right;
  if (popupRect.top < visible.top) y = popupRect.top - visible.top;
  if (popupRect.bottom > visible.bottom) y = popupRect.bottom - visible.bottom;
  if (x || y) map.panBy([x, y], { animate: true, duration: 0.25 });
}

async function loadTideDetails(station, target, marker) {
  target.innerHTML = '<span>Calculando fase da maré…</span>';
  try {
    const sensor = encodeURIComponent(station.sensor || '');
    const url = `https://www.ioc-sealevelmonitoring.org/service.php?query=data&code=${encodeURIComponent(station.code)}&format=json&includesensors%5B%5D=${sensor}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`fonte respondeu ${response.status}`);
    const rows = await response.json();
    const cutoff = Date.now() - 12 * 60 * 60 * 1000;
    const readings = rows.map(row => ({
      value: Number(row.slevel),
      time: parseUtcDate(row.stime)
    })).filter(reading => Number.isFinite(reading.value) && reading.value > -999 && reading.time && reading.time.getTime() >= cutoff)
      .sort((a, b) => a.time - b.time);
    if (readings.length < 20) throw new Error('amostras recentes insuficientes');
    const tide = tideState(readings);
    target.innerHTML = `
      <hr>
      <div class="tide-status"><span aria-hidden="true">${tide.icon}</span><strong>${escapeHtml(tide.label)}</strong></div>
      <div class="tide-grid">
        <span title="Variação recente" aria-label="Variação recente">≋</span><span>${tide.change >= 0 ? '+' : ''}${tide.change.toFixed(3)} m</span>
        <span title="Máxima observada em 12 horas" aria-label="Máxima observada">▲</span><span>${tide.maximum.value.toFixed(3)} m · ${escapeHtml(formatDate(tide.maximum.time))}</span>
        <span title="Mínima observada em 12 horas" aria-label="Mínima observada">▼</span><span>${tide.minimum.value.toFixed(3)} m · ${escapeHtml(formatDate(tide.minimum.time))}</span>
      </div>
      <small title="Estimativa baseada na tendência das leituras, não previsão oficial de preamar ou baixamar.">ⓘ Estimativa pelas últimas 12 h</small>
    `;
  } catch (error) {
    target.innerHTML = `<hr><small>Fase da maré indisponível: ${escapeHtml(error.message)}.</small>`;
  } finally {
    requestAnimationFrame(() => marker.getPopup()?.update());
  }
}

function renderSeaLevelRows(rows, updateLabel) {
    const byCode = new Map();

    rows.filter(row => row.country === 'BRA').forEach(row => {
      const code = String(row.Code || row.code || '').toLowerCase();
      const time = parseUtcDate(row.lasttime);
      const value = Number(row.lastvalue);
      if (!code || !time || !Number.isFinite(value) || value <= -999) return;
      const current = byCode.get(code);
      if (!current || time > current.time) byCode.set(code, { ...row, code, time, value });
    });

    const stations = [...byCode.values()].sort((a, b) => b.time - a.time);
    const recent = stations.filter(station => Date.now() - station.time.getTime() <= SEA_RECENT_MS);
    const latest = stations[0];

    seaLevelLayer.clearLayers();
    recent.forEach(station => {
      const lat = Number(station.lat ?? station.Lat);
      const lon = Number(station.lon ?? station.Lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const detailsId = `tide-details-${station.code.replace(/[^a-z0-9]/gi, '')}`;
      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        className: 'sea-level-marker',
        fillOpacity: 0.9,
        weight: 2
      }).bindPopup(`
        <div class="sea-popup">
          <strong class="sea-popup-title">${escapeHtml(station.Location)}</strong>
          <div class="sea-reading"><span aria-hidden="true">🌊</span><strong>${station.value.toFixed(3)} m</strong><small>nível bruto</small></div>
          <div class="sea-meta"><span title="Sensor">◉ ${escapeHtml(station.sensor || '—')}</span><span title="Horário da leitura">◷ ${escapeHtml(formatDate(station.time))}</span></div>
          <a title="Leitura relativa ao datum local; não corresponde ao nível médio do mar." href="https://www.ioc-sealevelmonitoring.org/station.php?code=${encodeURIComponent(station.code)}" target="_blank" rel="noopener">ⓘ Datum local e metadados ↗</a>
          <div id="${detailsId}" class="tide-details"><span>◌ Verificando maré…</span></div>
        </div>
      `, {
        minWidth: 220,
        maxWidth: 360,
        keepInView: true,
        autoPanPaddingTopLeft: [20, 20],
        autoPanPaddingBottomRight: [20, 20]
      });
      marker.on('popupopen', () => {
        const target = document.getElementById(detailsId);
        if (target && !target.dataset.loaded) {
          target.dataset.loaded = 'true';
          loadTideDetails(station, target, marker);
        }
        requestAnimationFrame(() => keepPopupInsideViewport(marker));
      });
      marker.addTo(seaLevelLayer);
    });

    el('sea-active-count').textContent = recent.length;
    el('map-sea-count').textContent = recent.length;
    el('sea-latest-age').textContent = latest ? `há ${relativeTime(latest.time.getTime())}` : '—';
    el('sea-latest-station').textContent = latest ? latest.Location : 'Nenhuma leitura disponível';
    el('sea-updated').textContent = updateLabel;
    el('sea-stations').innerHTML = recent.length
      ? recent.slice(0, 8).map(station => `
        <article class="sea-station">
          <span>${escapeHtml(station.code.toUpperCase())}</span>
          <strong>${escapeHtml(station.Location)}</strong>
          <strong class="sea-value">${station.value.toFixed(3)} m</strong>
          <small>Leitura bruta · há ${relativeTime(station.time.getTime())}</small>
        </article>`).join('')
      : '<div class="empty-state">Nenhuma estação brasileira enviou uma leitura válida nas últimas 3 horas.</div>';
}

async function loadSeaLevel() {
  const errorBox = el('sea-level-error');
  errorBox.hidden = true;
  let renderedCache = false;
  const liveRequest = fetch(SEA_LEVEL_URL, { cache: 'no-store' });

  try {
    const cacheResponse = await fetch(SEA_LEVEL_CACHE_URL, { cache: 'no-store' });
    if (cacheResponse.ok) {
      const cached = await cacheResponse.json();
      renderSeaLevelRows(cached.stations || [], `Dados locais de ${formatDate(cached.generatedAt)}`);
      renderedCache = true;
    }
  } catch (error) {
    console.warn('Cache local de marés indisponível:', error);
  }

  try {
    const response = await liveRequest;
    if (!response.ok) throw new Error(`Falha na fonte IOC/UNESCO (${response.status})`);
    const rows = await response.json();
    renderSeaLevelRows(rows, `Consulta ao vivo em ${formatDate(Date.now())}`);
  } catch (error) {
    if (!renderedCache) {
      errorBox.hidden = false;
      errorBox.textContent = `Não foi possível carregar o nível do mar: ${error.message}`;
      el('sea-stations').innerHTML = '';
    } else {
      console.warn('Atualização ao vivo de marés indisponível:', error);
    }
  }
}

function alertColor(severityName) {
  return { Extreme: '#dc2626', Severe: '#ea580c', Moderate: '#eab308', Minor: '#0891b2' }[severityName] || '#64748b';
}

function tsunamiAlertsEnabled() {
  return localStorage.getItem('tsunamiAlertsEnabled') === 'true' && Notification.permission === 'granted';
}

function updatePersonalAlertStatus() {
  const supported = 'Notification' in window;
  const enabled = supported && tsunamiAlertsEnabled();
  el('personal-alert-status').textContent = enabled ? 'Ativo neste navegador' : 'Desativado';
  el('personal-alert-detail').textContent = !supported
    ? 'Este navegador não oferece notificações.'
    : enabled
      ? 'Monitorando comunicados CAP oficiais para tsunami ou maremoto no Brasil.'
      : Notification.permission === 'denied'
        ? 'Notificações bloqueadas nas configurações do navegador.'
        : 'Receba uma notificação quando surgir um comunicado CAP oficial.';
  el('enable-tsunami-alerts').textContent = enabled ? 'Desativar alerta pessoal' : 'Ativar alerta pessoal';
  el('enable-tsunami-alerts').disabled = !supported || Notification.permission === 'denied';
}

async function togglePersonalTsunamiAlerts() {
  if (!('Notification' in window)) return;
  if (tsunamiAlertsEnabled()) {
    localStorage.setItem('tsunamiAlertsEnabled', 'false');
    updatePersonalAlertStatus();
    return;
  }
  const permission = await Notification.requestPermission();
  localStorage.setItem('tsunamiAlertsEnabled', String(permission === 'granted'));
  updatePersonalAlertStatus();
  if (permission === 'granted') {
    new Notification('Observatório Brasil', { body: 'Alerta pessoal de tsunami ativado neste navegador.' });
  }
}

function notifyNewTsunamiAlerts(features) {
  if (!tsunamiAlertsEnabled()) return;
  const tsunamiFeatures = features.filter(feature => {
    const item = feature.properties || {};
    return /tsunami|maremoto/i.test(`${item.event || ''} ${item.headline || ''}`);
  });
  const seen = new Set(JSON.parse(localStorage.getItem('seenTsunamiAlerts') || '[]'));
  tsunamiFeatures.forEach(feature => {
    const item = feature.properties || {};
    const id = item.identifier || `${item.sent || ''}:${item.headline || item.event || ''}`;
    if (seen.has(id)) return;
    new Notification(item.headline || item.event || 'Alerta oficial de tsunami', {
      body: `${item.areaDesc || 'Brasil'} · ${item.severity || 'severidade não informada'}`,
      tag: id
    });
    seen.add(id);
  });
  localStorage.setItem('seenTsunamiAlerts', JSON.stringify([...seen].slice(-100)));
}

async function loadOfficialAlerts() {
  try {
    const response = await fetch(CAP_ALERTS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha no agregador CAP (${response.status})`);
    const collection = await response.json();
    const now = Date.now();
    collection.features = (collection.features || []).filter(feature => {
      const expires = feature.properties?.expires;
      return !expires || new Date(expires).getTime() >= now;
    });
    notifyNewTsunamiAlerts(collection.features);

    alertLayer.clearLayers();
    alertLayer.addData(collection);
    alertLayer.eachLayer(layer => {
      const item = layer.feature.properties || {};
      const color = alertColor(item.severity);
      if (layer.setStyle) layer.setStyle({ color, fillColor: color, className: 'official-alert' });
      layer.bindPopup(`
        <strong>${escapeHtml(item.headline || item.event || 'Alerta oficial')}</strong><br>
        Área: ${escapeHtml(item.areaDesc || 'não informada')}<br>
        Severidade: ${escapeHtml(item.severity || 'não informada')}<br>
        Emissor: ${escapeHtml(item.senderName || 'autoridade CAP')}<br>
        ${item.web ? `<a href="${escapeHtml(item.web)}" target="_blank" rel="noopener">Abrir comunicado oficial ↗</a>` : ''}
      `);
    });
    el('map-alert-count').textContent = collection.features.length;
    syncMapLayers();
  } catch (error) {
    console.warn('Alertas oficiais indisponíveis:', error);
    el('map-alert-count').textContent = '—';
  }
}

function pointInsideBounds(feature, bounds) {
  const [lon, lat] = feature.geometry.coordinates;
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

async function searchLocation(query) {
  if (!query) return;
  const status = el('location-status');
  status.textContent = 'Buscando localidade…';
  el('location-dashboard').hidden = true;
  el('search-suggestions').hidden = true;

  const url = `${NOMINATIM_URL}?format=jsonv2&limit=5&addressdetails=1&accept-language=pt-BR&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 429) throw new Error('Muitas buscas em sequência. Aguarde alguns segundos e tente novamente.');
  if (!response.ok) throw new Error('Não foi possível pesquisar a localidade.');
  const results = await response.json();
  if (!results.length) {
    status.textContent = 'Nenhuma localidade encontrada. Tente incluir o estado ou país.';
    return;
  }
  showSuggestions(results);
}

function showSuggestions(results) {
  const suggestions = el('search-suggestions');
  suggestions.innerHTML = results.map((item, index) => `
    <button type="button" data-index="${index}">
      <strong>${escapeHtml(item.display_name.split(',')[0])}</strong>
      <span>${escapeHtml(item.display_name)}</span>
    </button>`).join('');
  suggestions.hidden = false;
  suggestions.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => selectLocation(results[Number(button.dataset.index)]));
  });
  el('location-status').textContent = 'Selecione a localidade correta nos resultados abaixo.';
}

function selectLocation(item) {
  const box = (item.boundingbox || []).map(Number);
  if (box.length !== 4 || box.some(value => !Number.isFinite(value))) {
    el('location-status').textContent = 'A localidade selecionada não possui área delimitada utilizável.';
    return;
  }
  const location = {
    name: item.display_name,
    shortName: item.display_name.split(',')[0],
    type: item.type || item.addresstype || 'localidade',
    lat: Number(item.lat),
    lon: Number(item.lon),
    bounds: { south: box[0], north: box[1], west: box[2], east: box[3] }
  };
  state.selectedLocation = location;
  el('search-suggestions').hidden = true;
  renderLocationDashboard(location);
}

function renderLocationDashboard(location) {
  const events = state.features.filter(feature => pointInsideBounds(feature, location.bounds));
  state.selectedEvents = events;
  const maxEvent = events.reduce((best, event) => (!best || magnitudeOf(event) > magnitudeOf(best) ? event : best), null);
  const latest = events[0] || null;
  const averageDepth = events.length
    ? events.reduce((sum, event) => sum + depthOf(event), 0) / events.length
    : 0;

  const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
  events.forEach(event => counts[severity(magnitudeOf(event)).key]++);
  const mainKey = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const main = SEVERITY_LABELS[mainKey];
  const attention = counts.critical > 0 ? ['Crítico', 'Há evento de magnitude 6,0 ou superior']
    : counts.high > 0 ? ['Elevado', 'Há evento de magnitude 4,5 ou superior']
    : counts.moderate > 0 ? ['Atenção', 'Foram registrados eventos moderados']
    : events.length ? ['Normal', 'Somente eventos de baixa magnitude']
    : ['Normal', 'Nenhum evento registrado na área'];

  el('selected-location').textContent = location.shortName;
  el('selected-type').textContent = `${location.type} • ${location.name}`;
  el('local-total').textContent = events.length;
  el('local-max-mag').textContent = maxEvent ? magnitudeOf(maxEvent).toFixed(1) : '—';
  el('local-max-place').textContent = maxEvent ? placeOf(maxEvent) : 'Nenhum evento';
  el('local-main-severity').textContent = events.length ? main : '—';
  el('local-main-severity-detail').textContent = events.length ? `${counts[mainKey]} ocorrência(s)` : 'Sem ocorrências';
  el('local-latest-time').textContent = latest ? `há ${relativeTime(latest.properties.time)}` : '—';
  el('local-latest-place').textContent = latest ? placeOf(latest) : 'Nenhum evento';
  el('local-average-depth').textContent = events.length ? `${averageDepth.toFixed(1)} km` : '—';
  el('local-attention').textContent = attention[0];
  el('local-attention-detail').textContent = attention[1];
  el('local-list-count').textContent = events.length;

  const total = Math.max(events.length, 1);
  el('severity-bars').innerHTML = Object.entries(counts).map(([key, value]) => `
    <div class="severity-row">
      <div><span>${SEVERITY_LABELS[key]}</span><strong>${value}</strong></div>
      <div class="bar"><i class="${key}" style="width:${(value / total) * 100}%"></i></div>
    </div>`).join('');

  renderEventList(el('local-events'), events.slice(0, 20));
  el('location-status').textContent = `Painel gerado para ${location.shortName}.`;
  el('location-dashboard').hidden = false;
}

function showSelectedOnMap() {
  if (!state.selectedLocation) return;
  document.querySelector('[data-view="map-view"]').click();
  const b = state.selectedLocation.bounds;
  const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
  if (selectedBoundsLayer) map.removeLayer(selectedBoundsLayer);
  selectedBoundsLayer = L.rectangle(bounds, { weight: 2, fillOpacity: 0.08 }).addTo(map);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
}

document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    el(tab.dataset.view).classList.add('active');
    if (tab.dataset.view === 'map-view') setTimeout(() => map.invalidateSize(), 50);
  });
});

el('refresh').addEventListener('click', loadData);
el('magnitude').addEventListener('change', renderMap);
el('show-quakes').addEventListener('change', syncMapLayers);
el('show-sea-level').addEventListener('change', syncMapLayers);
el('show-alerts').addEventListener('change', syncMapLayers);
el('enable-tsunami-alerts').addEventListener('click', togglePersonalTsunamiAlerts);
el('brazil-only').addEventListener('change', () => {
  const brazilOnly = el('brazil-only').checked;
  renderMap();
  if (brazilOnly) {
    map.fitBounds(
      [[BRAZIL_BOUNDS.south, BRAZIL_BOUNDS.west], [BRAZIL_BOUNDS.north, BRAZIL_BOUNDS.east]],
      { padding: [20, 20] }
    );
  } else {
    map.setView([15, 0], 2);
  }
});
el('location-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await searchLocation(el('location-query').value.trim()); }
  catch (error) { el('location-status').textContent = error.message; }
});
el('show-on-map').addEventListener('click', showSelectedOnMap);
document.querySelectorAll('[data-query]').forEach(button => {
  button.addEventListener('click', async () => {
    el('location-query').value = button.dataset.query;
    try { await searchLocation(button.dataset.query); }
    catch (error) { el('location-status').textContent = error.message; }
  });
});

loadData();
loadRoni();
loadSeaLevel();
updatePersonalAlertStatus();
loadOfficialAlerts();
createRiskInterface();
loadCemadenRisk();
setInterval(loadData, 5 * 60 * 1000);
setInterval(loadSeaLevel, 5 * 60 * 1000);
setInterval(loadOfficialAlerts, 5 * 60 * 1000);
