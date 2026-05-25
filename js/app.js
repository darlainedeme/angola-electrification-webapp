/* Angola Electrification Dashboard — app.js
 * Reads JSON data from data/, renders five views. Pure vanilla JS + Leaflet + Chart.js.
 * URL state: ?scenario=S60 etc.
 */

const SCENARIOS = ["S53", "S60", "S70"];
const STATE = { scenario: "S60", view: "overview" };

const dataStore = {
  summary: null,
  provinces: null,
  staged: null,
  critique: null,
  meta: null,
  clusters: {},        // lazy-loaded per scenario
};

// ---------- Utilities ----------
const fmtUSD_B = v => "$" + v.toFixed(2) + "B";
const fmtUSD_M = v => "$" + Math.round(v).toLocaleString() + "M";
const fmtConn = v => v >= 1 ? v.toFixed(2) + "M" : (v * 1000).toFixed(0) + "K";
const fmtPct = v => v.toFixed(1) + "%";

function setScenario(sc, push = true) {
  STATE.scenario = sc;
  document.querySelectorAll(".scenario-toggle button").forEach(b => {
    const active = b.dataset.sc === sc;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-sc-card]").forEach(c => {
    c.classList.toggle("selected", c.dataset.scCard === sc);
  });
  // re-render view-specific
  renderMap();
  renderModality();
  renderStaged();
  if (push) {
    const url = new URL(location.href);
    url.searchParams.set("scenario", sc);
    history.replaceState({}, "", url);
  }
}

function setView(v) {
  STATE.view = v;
  document.querySelectorAll(".tabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.view === v);
  });
  document.querySelectorAll(".view").forEach(s => {
    s.classList.toggle("active", s.id === "view-" + v);
  });
  if (v === "map" && _leafletMap) setTimeout(() => _leafletMap.invalidateSize(), 60);
  if (v === "modality") renderModality();
}

// ---------- Data loading ----------
async function loadAll() {
  const [summary, provinces, staged, critique, meta] = await Promise.all([
    fetch("data/summary.json").then(r => r.json()),
    fetch("data/provinces.json").then(r => r.json()),
    fetch("data/staged.json").then(r => r.json()),
    fetch("data/critique.json").then(r => r.json()),
    fetch("data/meta.json").then(r => r.json()),
  ]);
  Object.assign(dataStore, { summary, provinces, staged, critique, meta });
}

async function loadClusters(sc) {
  if (dataStore.clusters[sc]) return dataStore.clusters[sc];
  const j = await fetch(`data/clusters/${sc}.json`).then(r => r.json());
  dataStore.clusters[sc] = j;
  return j;
}

// ---------- Overview ----------
function renderOverview() {
  const H = dataStore.summary.headline;
  for (const sc of SCENARIOS) {
    const h = H[sc];
    const id = sc.replace("S", "ov");
    const totalEl = document.getElementById(id + "-total");
    if (totalEl) {
      totalEl.textContent = fmtUSD_B(h.total_cost_usd_b);
      document.getElementById(id + "-conn").textContent = fmtConn(h.new_connections_m);
      document.getElementById(id + "-grid").textContent = fmtPct(h.share_grid_hh_pct);
      document.getElementById(id + "-shs").textContent = fmtPct(100 - h.share_grid_hh_pct);
    }
  }

  // Comparison table
  for (const sc of SCENARIOS) {
    const h = H[sc];
    const num = sc.replace("S", "");
    document.getElementById(`t-${num}-cost`).textContent = fmtUSD_B(h.total_cost_usd_b);
    document.getElementById(`t-${num}-conn`).textContent = fmtConn(h.new_connections_m);
    const cpc = (h.total_cost_usd_b * 1e9) / (h.new_connections_m * 1e6);
    document.getElementById(`t-${num}-cpc`).textContent = "$" + Math.round(cpc).toLocaleString();
    document.getElementById(`t-${num}-gs`).textContent = fmtPct(h.share_grid_hh_pct);
  }

  document.getElementById("cmp-70-total").textContent = fmtUSD_B(H.S70.total_cost_usd_b);
}

// ---------- Map ----------
let _leafletMap = null;
let _provLayer = null;
let _clusterLayer = null;

function initMap() {
  _leafletMap = L.map("map", { preferCanvas: true }).setView([-12.5, 18.5], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap, &copy; CartoDB',
    maxZoom: 18,
  }).addTo(_leafletMap);
}

function provColor(value, max, mode) {
  // simple sequential ramp
  const t = max > 0 ? Math.min(1, value / max) : 0;
  if (mode === "grid_share") {
    // navy (high grid) to orange (high SHS)
    const r = Math.round(255 * (1 - t) + 0 * t);
    const g = Math.round(140 * (1 - t) + 34 * t);
    const b = Math.round(0 * (1 - t) + 68 * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // pale -> red
    const r = 255;
    const g = Math.round(245 - 175 * t);
    const b = Math.round(230 - 200 * t);
    return `rgb(${r},${g},${b})`;
  }
}

function renderMap() {
  if (!_leafletMap) return;
  if (_provLayer) _leafletMap.removeLayer(_provLayer);
  _provLayer = L.layerGroup().addTo(_leafletMap);

  const mode = document.querySelector("input[name='map-mode']:checked").value;
  const rows = dataStore.provinces.filter(p => p.scenario === STATE.scenario);
  const max = mode === "grid_share" ? 100 : Math.max(...rows.map(p => p.total_cost_usd_m));

  rows.forEach(p => {
    if (p.lat == null) return;
    const value = mode === "grid_share" ? p.grid_share_pct : p.total_cost_usd_m;
    // Circle radius proportional to cost (sqrt scale)
    const radius = mode === "grid_share"
      ? 14
      : 8 + 32 * Math.sqrt(p.total_cost_usd_m / max);
    const fill = provColor(value, max, mode);
    const circle = L.circleMarker([p.lat, p.lon], {
      radius,
      fillColor: fill,
      color: "#002244",
      weight: 1.5,
      fillOpacity: 0.85,
    });
    circle.bindPopup(buildProvPopup(p));
    circle.on("click", () => openDrawer(p));
    _provLayer.addLayer(circle);

    // Province label
    const label = L.divIcon({
      className: "prov-marker",
      html: p.province,
      iconSize: [80, 16],
    });
    L.marker([p.lat, p.lon], { icon: label, interactive: false, opacity: 0.85 })
      .addTo(_provLayer);
  });

  // Cluster points if toggled
  const showClusters = document.getElementById("show-clusters").checked;
  if (_clusterLayer) {
    _leafletMap.removeLayer(_clusterLayer);
    _clusterLayer = null;
  }
  if (showClusters) {
    loadClusters(STATE.scenario).then(payload => {
      _clusterLayer = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: false,
      });
      const idx = { lat: 0, lon: 1, mode: 2, conn: 3, cost_k: 4, province: 5 };
      payload.rows.forEach(r => {
        const color = r[idx.mode] === "g" ? "#2E75B6" : "#f08c00";
        const m = L.circleMarker([r[idx.lat], r[idx.lon]], {
          radius: Math.max(2, Math.sqrt(r[idx.conn] / 100)),
          fillColor: color,
          color: color,
          weight: 0,
          fillOpacity: 0.7,
        });
        m.bindPopup(`<strong>${r[idx.province]}</strong><br>
          Mode: ${r[idx.mode] === "g" ? "Grid" : "SHS"}<br>
          Connections: ${r[idx.conn].toLocaleString()}<br>
          Cost: $${r[idx.cost_k].toLocaleString()}k`);
        _clusterLayer.addLayer(m);
      });
      _leafletMap.addLayer(_clusterLayer);
    });
  }
}

function buildProvPopup(p) {
  return `<table>
    <tr><td>Total cost</td><td>${fmtUSD_M(p.total_cost_usd_m)}</td></tr>
    <tr><td>Grid cost</td><td>${fmtUSD_M(p.grid_cost_usd_m)}</td></tr>
    <tr><td>SHS cost</td><td>${fmtUSD_M(p.shs_cost_usd_m)}</td></tr>
    <tr><td>New grid HH</td><td>${Math.round(p.additional_connections_grid).toLocaleString()}</td></tr>
    <tr><td>New SHS HH</td><td>${Math.round(p.additional_connections_shs).toLocaleString()}</td></tr>
    <tr><td>Grid share</td><td>${fmtPct(p.grid_share_pct)}</td></tr>
  </table>`;
}

function openDrawer(p) {
  document.getElementById("drawer-title").textContent = p.province;
  document.getElementById("drawer-table").innerHTML = `
    <tr><td>Population 2025</td><td>${p.pop_2025_m.toFixed(2)}M</td></tr>
    <tr><td>Population 2030</td><td>${p.pop_2030_m.toFixed(2)}M</td></tr>
    <tr><td>Baseline connected 2025</td><td>${Math.round(p.baseline_connected_2025).toLocaleString()}</td></tr>
    <tr><td>New grid (HH)</td><td>${Math.round(p.additional_connections_grid).toLocaleString()}</td></tr>
    <tr><td>New SHS (HH)</td><td>${Math.round(p.additional_connections_shs).toLocaleString()}</td></tr>
    <tr><td>Grid cost</td><td>${fmtUSD_M(p.grid_cost_usd_m)}</td></tr>
    <tr><td>SHS cost</td><td>${fmtUSD_M(p.shs_cost_usd_m)}</td></tr>
    <tr><td>Total cost</td><td>${fmtUSD_M(p.total_cost_usd_m)}</td></tr>
    <tr><td>Grid share</td><td>${fmtPct(p.grid_share_pct)}</td></tr>
  `;
  document.getElementById("prov-drawer").classList.remove("hidden");
}

// ---------- Modality ----------
let _chartConn = null, _chartCost = null;
function renderModality() {
  const M = dataStore.summary.modality;
  if (!M) return;

  const labels = SCENARIOS;
  const gridConn = labels.map(sc => (M[sc].find(r => r.modality.startsWith("Grid"))?.connections || 0) / 1e6);
  const shsConn  = labels.map(sc => (M[sc].find(r => r.modality.startsWith("SHS"))?.connections  || 0) / 1e6);
  const gridCost = labels.map(sc => (M[sc].find(r => r.modality.startsWith("Grid"))?.total_cost_usd_m || 0));
  const shsCost  = labels.map(sc => (M[sc].find(r => r.modality.startsWith("SHS"))?.total_cost_usd_m  || 0));

  const baseConnOpts = {
    type: "bar",
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
    },
  };

  if (_chartConn) _chartConn.destroy();
  _chartConn = new Chart(document.getElementById("chart-conn"), {
    ...baseConnOpts,
    data: {
      labels,
      datasets: [
        { label: "Grid", data: gridConn, backgroundColor: "#2E75B6" },
        { label: "SHS",  data: shsConn,  backgroundColor: "#f08c00" },
      ],
    },
  });

  if (_chartCost) _chartCost.destroy();
  _chartCost = new Chart(document.getElementById("chart-cost"), {
    ...baseConnOpts,
    data: {
      labels,
      datasets: [
        { label: "Grid ($M)", data: gridCost, backgroundColor: "#2E75B6" },
        { label: "SHS ($M)",  data: shsCost,  backgroundColor: "#f08c00" },
      ],
    },
  });

  const tbody = document.getElementById("mod-tbody");
  tbody.innerHTML = "";
  for (const sc of SCENARIOS) {
    for (const row of M[sc]) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${sc}</strong></td>
        <td>${row.modality}</td>
        <td>$${row.unit_cost_usd.toLocaleString()}</td>
        <td>${Math.round(row.connections).toLocaleString()}</td>
        <td>${fmtUSD_M(row.total_cost_usd_m)}</td>`;
      tbody.appendChild(tr);
    }
  }
}

// ---------- Staged ----------
function renderStaged() {
  const sc = STATE.scenario;
  const rows = dataStore.staged.filter(r => r.scenario === sc);
  const el = document.getElementById("staged-timeline");
  if (rows.length === 0) {
    el.innerHTML = `<p style="color:var(--text-muted)">The ${sc} scenario has no staged delivery program — it represents the do-minimum baseline (infrastructure only).</p>`;
    return;
  }
  el.innerHTML = rows.map(r => `
    <div class="stage-row">
      <div>
        <div class="stage-name">${r.stage}</div>
        <div class="stage-years">${r.years}</div>
      </div>
      <div></div>
      <div class="stage-milestone">${r.milestone}</div>
      <div class="stage-cost">
        $${r.capex_mid_m}M
        <div class="range">range $${r.capex_low_m} - $${r.capex_high_m}M</div>
      </div>
    </div>
  `).join("");
}

// ---------- Critique ----------
function renderCritique() {
  const t = document.getElementById("critique-table");
  let html = `<thead><tr>
    <th>Weakness</th>
    <th>Compact value</th>
    <th>Reconciled value</th>
    <th>Source basis</th>
  </tr></thead><tbody>`;
  for (const row of dataStore.critique) {
    html += `<tr>
      <td>${row.weakness}</td>
      <td>${row.compact_value}</td>
      <td>${row.reconciled_value}</td>
      <td>${row.source_basis}</td>
    </tr>`;
  }
  html += `</tbody>`;
  t.innerHTML = html;
}

// ---------- Footer ----------
function renderFooter() {
  document.getElementById("footer-data-version").textContent = dataStore.meta.data_version;
  document.getElementById("footer-build-date").textContent = dataStore.meta.build_date;
  document.getElementById("footer-timestamp").textContent = dataStore.meta.run_timestamp.split("T")[0];
  document.getElementById("footer-src").textContent = dataStore.meta.src_file;
}

// ---------- Wire up ----------
document.addEventListener("DOMContentLoaded", async () => {
  await loadAll();

  // URL-state scenario
  const urlSc = new URLSearchParams(location.search).get("scenario");
  if (urlSc && SCENARIOS.includes(urlSc)) STATE.scenario = urlSc;

  initMap();
  renderOverview();
  renderCritique();
  renderFooter();
  setScenario(STATE.scenario, false);

  document.querySelectorAll(".scenario-toggle button").forEach(b => {
    b.addEventListener("click", () => setScenario(b.dataset.sc));
  });
  document.querySelectorAll(".tabs button").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  document.querySelectorAll("input[name='map-mode']").forEach(r => {
    r.addEventListener("change", renderMap);
  });
  document.getElementById("show-clusters").addEventListener("change", renderMap);
  document.querySelector(".prov-drawer .close-btn").addEventListener("click", () => {
    document.getElementById("prov-drawer").classList.add("hidden");
  });
});
