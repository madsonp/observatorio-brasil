const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

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
let selectedBoundsLayer = null;

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

  state.filtered = state.features.filter(feature => {
    return magnitudeOf(feature) >= minMag && (!brazilOnly || isBrazilRegion(feature));
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
  renderEventList(el('events'), state.filtered.slice(0, 50));
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
el('brazil-only').addEventListener('change', renderMap);
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
setInterval(loadData, 5 * 60 * 1000);
