// Angola Electrification 2030 — v4 Compact response (3 scenarios)
// Adapted from the original v3 webapp. Adds a scenario toggle (S53/S60/S70)
// that swaps cluster GeoJSON, re-renders headline cards, cost stack and tables.

const COLORS = {
  densification:  "#1f3a8a",  // navy
  extension:      "#60a5fa",  // light blue
  shs:            "#fde047",  // yellow
  remaining:      "#cbd5e1",  // grey
};
const LABELS = {
  densification: "Densification",
  extension: "Extension",
  shs: "SHS",
  remaining: "Remaining",
};
const SCENARIOS = ["S53", "S60", "S70"];

const state = {
  page: "overview",
  scenario: "S60",
  basemap: "osm",
  catVisible:  { densification: true, extension: true, shs: true, remaining: false },
  pCatVisible: { densification: true, extension: true, shs: true, remaining: false },
  showGrid: true,
  showAdmin: true,
  // Data
  clusters: {},        // {S53: gj, S60: gj, S70: gj} loaded lazily
  provincesAll: null,  // full list across scenarios
  costStackAll: null,  // {S53: rows, S60: rows, S70: rows}
  summary: null,
  meta: null,
  critique: null,
  adminGeoJSON: null,
  gridGeoJSON: null,
  // Map state
  map: null, clusterLayer: null, gridLayer: null, adminLayer: null,
  selectedProvince: "Luanda",
  pMap: null, pClusterLayer: null, pAdminLayer: null,
  provinceSort: { key: "plan_cost", dir: -1 },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function fmtMoney(n, digits = 2) {
  if (n == null || isNaN(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(digits) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n);
}
function fmtNumber(n, digits = 0) {
  if (n == null || isNaN(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return Math.round(n).toLocaleString();
}
function fmtPct(n, digits = 1) {
  if (n == null || isNaN(n)) return "–";
  return Number(n).toFixed(digits) + "%";
}
function setLoading(msg) {
  const el = $("#loading-overlay");
  if (!msg) { el.classList.add("hidden"); return; }
  $("#loading-msg").textContent = msg;
  el.classList.remove("hidden");
}
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed: ${path} (${r.status})`);
  return r.json();
}

// =================== BASEMAPS ===================
const osmA = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OSM" });
const satA = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "&copy; Esri" });
const osmP = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OSM" });
const satP = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "&copy; Esri" });

function setBasemap(kind) {
  const m = state.page === "province" ? state.pMap : state.map;
  if (!m) return;
  const useOsm = kind === "osm";
  const o = m === state.map ? osmA : osmP;
  const s = m === state.map ? satA : satP;
  if (useOsm) { if (m.hasLayer(s)) m.removeLayer(s); if (!m.hasLayer(o)) o.addTo(m); }
  else        { if (m.hasLayer(o)) m.removeLayer(o); if (!m.hasLayer(s)) s.addTo(m); }
  state.basemap = kind;
}

// =================== OVERVIEW MAP ===================
function initOverviewMap() {
  state.map = L.map("map", { preferCanvas: true, renderer: L.canvas() }).setView([-12.5, 17.5], 6);
  osmA.addTo(state.map);
}

function buildClusterLayer() {
  if (state.clusterLayer) state.map.removeLayer(state.clusterLayer);
  const gj = state.clusters[state.scenario];
  if (!gj) return;
  // Order: remaining first (background), then shs, then extension, then densification on top
  const order = ["remaining", "shs", "extension", "densification"];
  const feats = gj.features.slice().sort((a, b) =>
    order.indexOf(a.properties.lbl) - order.indexOf(b.properties.lbl));
  state.clusterLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: clusterRadius(f.properties.lbl),
      fillColor: COLORS[f.properties.lbl] || "#999",
      color: COLORS[f.properties.lbl] || "#999",
      weight: 0,
      fillOpacity: f.properties.lbl === "remaining" ? 0.4 : 0.85,
      stroke: false,
    }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.on("click", () => {
        layer.bindPopup(`
          <div class="cluster-popup">
            <div class="row"><span class="k">Cluster id</span><span class="v">${p.id}</span></div>
            <div class="row"><span class="k">Province</span><span class="v">${p.p}</span></div>
            <div class="row"><span class="k">Pop 2030</span><span class="v">${fmtNumber(p.pop)}</span></div>
            <div class="row"><span class="k">Category</span><span class="v">${LABELS[p.lbl]}</span></div>
            <div class="row"><span class="k">Connections (plan)</span><span class="v">${fmtNumber(p.conns)}</span></div>
            <div class="row"><span class="k">Cost (plan)</span><span class="v">${fmtMoney(p.cost)}</span></div>
          </div>
        `).openPopup();
      });
    },
  });
  state.clusterLayer.addTo(state.map);
  applyCatVisibility();
}
function clusterRadius(lbl) {
  return lbl === "extension" ? 4.5 : lbl === "densification" ? 3.5 : lbl === "remaining" ? 1.5 : 2.5;
}

function applyCatVisibility() {
  if (!state.clusterLayer) return;
  state.clusterLayer.eachLayer((layer) => {
    const lbl = layer.feature.properties.lbl;
    const vis = state.catVisible[lbl];
    layer.setStyle({
      radius: vis ? clusterRadius(lbl) : 0,
      fillOpacity: vis ? (lbl === "remaining" ? 0.4 : 0.85) : 0,
    });
  });
}

function buildGridLayer() {
  if (state.gridLayer) state.map.removeLayer(state.gridLayer);
  state.gridLayer = L.geoJSON(state.gridGeoJSON, {
    style: (f) => {
      const v = f.properties.VOLTAGE_KV || 0;
      const status = (f.properties.STATUS || "").toLowerCase();
      const colour = v >= 220 ? "#dc2626" : v >= 132 ? "#ea580c" : "#9333ea";
      const dashed = status.includes("construction") || status.includes("planned");
      return { color: colour, weight: 1.8, opacity: 0.85, dashArray: dashed ? "4,4" : null };
    },
    onEachFeature: (f, l) => {
      const p = f.properties;
      l.bindTooltip(`${p.FROM_NM} → ${p.TO_NM} (${p.VOLTAGE_KV}kV, ${p.STATUS})`);
    },
  });
  if (state.showGrid) state.gridLayer.addTo(state.map);
}

function buildAdminLayer() {
  if (state.adminLayer) state.map.removeLayer(state.adminLayer);
  state.adminLayer = L.geoJSON(state.adminGeoJSON, {
    style: { color: "#475569", weight: 1, fillOpacity: 0.04, fillColor: "#94a3b8" },
    onEachFeature: (f, l) => { l.bindTooltip(f.properties.province, { sticky: true, direction: "center" }); },
  });
  if (state.showAdmin) state.adminLayer.addTo(state.map);
}

// =================== HEADLINE + COST STACK ===================
function renderHeadline() {
  const h = state.summary.headline[state.scenario];
  const sc = state.scenario;
  const cards = [
    ["Total cost", fmtMoney(h.total_cost_b * 1e9, 2), true],
    ["Connections", fmtNumber(h.total_conn_m * 1e6), false],
    ["Access 2030", fmtPct(h.target_pct), false],
    ["Grid cost share", fmtPct(h.grid_cost_share_pct), false],
    ["Densification", fmtMoney(h.densification_cost_m * 1e6, 1), false],
    ["SHS cost", fmtMoney(h.shs_cost_m * 1e6, 1), false],
  ];
  const wrap = $("#headline-cards");
  wrap.innerHTML = "";
  cards.forEach(([label, value, highlight]) => {
    const div = document.createElement("div");
    div.className = "card" + (highlight ? " highlight" : "");
    div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    wrap.appendChild(div);
  });
}

function renderCostStack(target = "#cost-stack", source = null) {
  const rows = (source || state.costStackAll[state.scenario]).filter((r) => !String(r.row).includes("TOTAL"));
  const wrap = $(target);
  wrap.innerHTML = "";
  const max = Math.max(...rows.map((r) => r.cost_usd_M), 1);
  const palette = {
    "Densification (existing-grid expansion)": COLORS.densification,
    "Extension (new MV/LV grid)": COLORS.extension,
    "SHS": COLORS.shs,
    "Programme overhead (staged delivery)": "#94a3b8",
  };
  rows.forEach((r) => {
    const w = Math.max(2, (r.cost_usd_M / max) * 100);
    const row = document.createElement("div");
    row.className = "stack-row";
    row.innerHTML = `
      <div class="stack-bar" style="width:${w}%; background:${palette[r.row] || "#888"}"></div>
      <div class="stack-label" title="${r.row}">${shortRowName(r.row)}</div>
      <div class="stack-value">${fmtMoney(r.cost_usd_M * 1e6, 1)}</div>
    `;
    wrap.appendChild(row);
  });
}
function shortRowName(s) {
  return s.replace("Densification (existing-grid expansion)", "Densification")
          .replace("Extension (new MV/LV grid)", "Extension")
          .replace("Programme overhead (staged delivery)", "Programme overhead");
}

function renderCostTable() {
  const rows = state.costStackAll[state.scenario];
  const tbody = $("#cost-table tbody");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const isTotal = String(r.row).includes("TOTAL");
    const dollarPerConn = r.connections > 0 ? (r.cost_usd_M * 1e6) / r.connections : null;
    tr.innerHTML = `
      <td style="${isTotal ? 'font-weight:700' : ''}">${r.row}</td>
      <td>${fmtNumber(r.connections)}</td>
      <td>${r.cost_usd_M.toFixed(1)}</td>
      <td>${dollarPerConn ? fmtMoney(dollarPerConn, 0) : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderProvinceTable() {
  const rows = state.provincesAll.filter((p) => p.scenario === state.scenario);
  const tbody = $("#province-table tbody");
  tbody.innerHTML = "";
  const sorted = rows.slice().sort((a, b) => {
    const x = a[state.provinceSort.key], y = b[state.provinceSort.key];
    if (typeof x === "string") return state.provinceSort.dir * x.localeCompare(y);
    return state.provinceSort.dir * ((x || 0) - (y || 0));
  });
  sorted.forEach((p) => {
    const tr = document.createElement("tr");
    const cls = p.access_2030_pct >= state.summary.headline[state.scenario].target_pct ? "access-met" : "access-short";
    tr.innerHTML = `
      <td>${p.Admin1_n}</td>
      <td>${fmtNumber(p.in_plan_clusters)}</td>
      <td>${fmtNumber(p.plan_conns)}</td>
      <td>${(p.plan_cost / 1e6).toFixed(1)}</td>
      <td>${((p.densif_cost || 0) / 1e6).toFixed(1)}</td>
      <td>${((p.extension_cost || 0) / 1e6).toFixed(1)}</td>
      <td>${((p.shs_cost || 0) / 1e6).toFixed(1)}</td>
      <td class="${cls}">${fmtPct(p.access_2030_pct)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCompareTable() {
  const H = state.summary.headline;
  const rows = [
    ["Total cost",          "$4.6B",  fmtMoney(H.S53.total_cost_b * 1e9, 2), fmtMoney(H.S60.total_cost_b * 1e9, 2), fmtMoney(H.S70.total_cost_b * 1e9, 2)],
    ["New connections",     "1.7M",   fmtNumber(H.S53.total_conn_m * 1e6),   fmtNumber(H.S60.total_conn_m * 1e6),   fmtNumber(H.S70.total_conn_m * 1e6)],
    ["$/connection (avg)",  "~$2,700", "$" + Math.round(H.S53.total_cost_b * 1e9 / (H.S53.total_conn_m * 1e6)).toLocaleString(),
                                       "$" + Math.round(H.S60.total_cost_b * 1e9 / (H.S60.total_conn_m * 1e6)).toLocaleString(),
                                       "$" + Math.round(H.S70.total_cost_b * 1e9 / (H.S70.total_conn_m * 1e6)).toLocaleString()],
    ["Grid cost share",     "not stated", fmtPct(H.S53.grid_cost_share_pct), fmtPct(H.S60.grid_cost_share_pct), fmtPct(H.S70.grid_cost_share_pct)],
    ["Grid conn share",     "not stated", fmtPct(H.S53.grid_conn_share_pct), fmtPct(H.S60.grid_conn_share_pct), fmtPct(H.S70.grid_conn_share_pct)],
  ];
  const tbody = $("#compare-table tbody");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td>`;
    tbody.appendChild(tr);
  });
}

// =================== PROVINCE FOCUS ===================
function initProvincePage() {
  state.pMap = L.map("province-map", { preferCanvas: true, renderer: L.canvas() }).setView([-12.5, 17.5], 6);
  osmP.addTo(state.pMap);
  const sel = $("#province-select");
  sel.innerHTML = "";
  const provNames = Array.from(new Set(state.provincesAll.map((p) => p.Admin1_n))).sort();
  provNames.forEach((name) => {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });
  sel.value = state.selectedProvince;
  sel.addEventListener("change", () => {
    state.selectedProvince = sel.value;
    renderProvinceView();
  });
  renderProvinceView();
}

function renderProvinceView() {
  const rows = state.provincesAll.filter((p) => p.scenario === state.scenario);
  const prov = rows.find((p) => p.Admin1_n === state.selectedProvince);
  if (!prov) return;

  const wrap = $("#province-cards");
  wrap.innerHTML = "";
  const targetPct = state.summary.headline[state.scenario].target_pct;
  const cards = [
    ["Pop 2030", fmtNumber(prov.pop_2030)],
    ["Already electrified", fmtNumber(prov.elec_2025)],
    ["Plan connections", fmtNumber(prov.plan_conns)],
    ["Plan cost", fmtMoney(prov.plan_cost, 1)],
    ["Access 2030", fmtPct(prov.access_2030_pct), prov.access_2030_pct >= targetPct ? "highlight" : ""],
  ];
  cards.forEach(([l, v, cls]) => {
    const d = document.createElement("div");
    d.className = "card" + (cls ? " " + cls : "");
    d.innerHTML = `<div class="label">${l}</div><div class="value">${v}</div>`;
    wrap.appendChild(d);
  });

  // Cluster breakdown
  const bwrap = $("#province-breakdown");
  bwrap.innerHTML = "";
  const b = [
    ["Densification", prov.densification_clusters || 0],
    ["Extension", prov.extension_clusters || 0],
    ["SHS", prov.shs_clusters || 0],
  ];
  b.forEach(([l, v]) => {
    const d = document.createElement("div");
    d.className = "card";
    d.innerHTML = `<div class="label">${l}</div><div class="value">${fmtNumber(v)}</div>`;
    bwrap.appendChild(d);
  });

  // Per-province cost stack
  const provCostStack = [
    { row: "Densification (existing-grid expansion)", connections: prov.densification_clusters, cost_usd_M: (prov.densif_cost || 0) / 1e6 },
    { row: "Extension (new MV/LV grid)",              connections: prov.extension_clusters,    cost_usd_M: (prov.extension_cost || 0) / 1e6 },
    { row: "SHS",                                     connections: prov.shs_clusters,          cost_usd_M: (prov.shs_cost || 0) / 1e6 },
  ];
  renderCostStack("#province-cost-stack", provCostStack);
  renderProvinceMap(prov);
}

function renderProvinceMap(prov) {
  if (state.pClusterLayer) state.pMap.removeLayer(state.pClusterLayer);
  if (state.pAdminLayer)   state.pMap.removeLayer(state.pAdminLayer);
  const pgon = state.adminGeoJSON.features.find((f) => f.properties.province === prov.Admin1_n);
  if (pgon) {
    state.pAdminLayer = L.geoJSON(pgon, {
      style: { color: "#1f3a8a", weight: 2, fillColor: "#94c5fb", fillOpacity: 0.05 },
    }).addTo(state.pMap);
    state.pMap.fitBounds(state.pAdminLayer.getBounds(), { padding: [20, 20] });
  }
  const gj = state.clusters[state.scenario];
  if (!gj) return;
  const feats = gj.features.filter((f) => f.properties.p === prov.Admin1_n);
  state.pClusterLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: f.properties.lbl === "extension" ? 6 : f.properties.lbl === "densification" ? 4.5 : 3,
      fillColor: COLORS[f.properties.lbl] || "#999",
      color: COLORS[f.properties.lbl] || "#999",
      weight: 0,
      fillOpacity: state.pCatVisible[f.properties.lbl] ? 0.85 : 0,
      stroke: false,
    }),
  }).addTo(state.pMap);
}

// =================== CRITIQUE ===================
function renderCritique() {
  const tbody = $("#critique-table tbody");
  tbody.innerHTML = "";
  state.critique.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.weakness}</td><td>${r.compact_value}</td><td>${r.reconciled_value}</td><td>${r.source_basis}</td>`;
    tbody.appendChild(tr);
  });
}

// =================== FOOTER ===================
function renderFooter() {
  $("#footer-data-version").textContent = state.meta.data_version;
  $("#footer-build-date").textContent   = state.meta.build_date;
  $("#footer-timestamp").textContent    = state.meta.run_timestamp.split("T")[0];
  $("#footer-src").textContent          = state.meta.src_file;
}

// =================== SCENARIO SWITCHING ===================
async function setScenario(sc, pushURL = true) {
  if (sc === state.scenario && state.clusters[sc]) return;
  state.scenario = sc;
  $$(".scenario-switch button").forEach((b) => {
    const on = b.dataset.sc === sc;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });

  // Lazy-load this scenario's cluster file if not already in memory
  if (!state.clusters[sc]) {
    setLoading(`Loading ${sc} clusters…`);
    state.clusters[sc] = await loadJSON(`data/clusters_${sc}.geojson`);
    setLoading(null);
  }

  // Re-render everything scenario-dependent
  renderHeadline();
  renderCostStack();
  renderCostTable();
  renderProvinceTable();
  buildClusterLayer();
  if (state.page === "province") renderProvinceView();

  if (pushURL) {
    const u = new URL(location.href);
    u.searchParams.set("scenario", sc);
    history.replaceState({}, "", u);
  }
}

// =================== WIRING ===================
function wireControls() {
  $("#sidebar-toggle").addEventListener("click", () => {
    $("#sidebar").classList.toggle("closed");
    setTimeout(() => state.map.invalidateSize(), 250);
  });
  $("#province-sidebar-toggle").addEventListener("click", () => {
    $("#province-sidebar").classList.toggle("closed");
    setTimeout(() => state.pMap && state.pMap.invalidateSize(), 250);
  });
  $("#bottom-toggle").addEventListener("click", () => {
    $("#bottom-panel").classList.toggle("closed");
    setTimeout(() => state.map.invalidateSize(), 250);
  });
  $$(".page-tab").forEach((b) => b.addEventListener("click", () => switchPage(b.dataset.page)));
  $$(".bottom-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      $$(".bottom-tabs button").forEach((x) => x.classList.toggle("active", x === b));
      $$(".tab-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== b.dataset.tab));
    });
  });
  $("#basemap-select").addEventListener("change", (e) => setBasemap(e.target.value));
  $$(".cat-toggle").forEach((cb) => cb.addEventListener("change", () => {
    state.catVisible[cb.dataset.cat] = cb.checked;
    applyCatVisibility();
  }));
  $$(".pcat-toggle").forEach((cb) => cb.addEventListener("change", () => {
    state.pCatVisible[cb.dataset.cat] = cb.checked;
    const rows = state.provincesAll.filter((p) => p.scenario === state.scenario);
    const prov = rows.find((p) => p.Admin1_n === state.selectedProvince);
    if (prov) renderProvinceMap(prov);
  }));
  $("#lyr-grid").addEventListener("change", (e) => {
    state.showGrid = e.target.checked;
    if (state.showGrid) state.gridLayer.addTo(state.map); else state.map.removeLayer(state.gridLayer);
  });
  $("#lyr-admin").addEventListener("change", (e) => {
    state.showAdmin = e.target.checked;
    if (state.showAdmin) state.adminLayer.addTo(state.map); else state.map.removeLayer(state.adminLayer);
  });
  $$("#province-table thead th").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort; if (!k) return;
      state.provinceSort.dir = state.provinceSort.key === k ? -state.provinceSort.dir : -1;
      state.provinceSort.key = k;
      renderProvinceTable();
    });
  });
  $$(".scenario-switch button").forEach((b) => {
    b.addEventListener("click", () => setScenario(b.dataset.sc));
  });
}

function switchPage(name) {
  state.page = name;
  $$(".page-tab").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${name}`));
  if (name === "overview") setTimeout(() => state.map.invalidateSize(), 100);
  else if (name === "province") {
    if (!state.pMap) initProvincePage();
    else setTimeout(() => state.pMap.invalidateSize(), 100);
  }
}

// =================== INIT ===================
async function init() {
  initOverviewMap();
  setLoading("Loading plan data…");

  // URL state — scenario from query string
  const urlSc = new URLSearchParams(location.search).get("scenario");
  if (urlSc && SCENARIOS.includes(urlSc)) state.scenario = urlSc;

  [state.costStackAll, state.provincesAll, state.adminGeoJSON, state.gridGeoJSON,
   state.summary, state.meta, state.critique] = await Promise.all([
    loadJSON("data/cost_stack.json"),
    loadJSON("data/provinces.json"),
    loadJSON("data/admin1.geojson"),
    loadJSON("data/existing_grid.geojson"),
    loadJSON("data/summary.json"),
    loadJSON("data/meta.json"),
    loadJSON("data/critique.json"),
  ]);

  $$(".scenario-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.sc === state.scenario);
  });

  renderHeadline();
  renderCostStack();
  renderCostTable();
  renderProvinceTable();
  renderCompareTable();
  renderCritique();
  renderFooter();
  buildAdminLayer();
  buildGridLayer();

  setLoading(`Loading ${state.scenario} clusters (this can take a moment)…`);
  state.clusters[state.scenario] = await loadJSON(`data/clusters_${state.scenario}.geojson`);
  buildClusterLayer();
  wireControls();
  setLoading(null);
}
init().catch((err) => { console.error(err); setLoading("Error: " + err.message); });
