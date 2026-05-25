// Angola Electrification 2030 — v4 Compact response (3 scenarios)
// Adapted from the original v3 webapp. Adds a scenario toggle (S53/S60/S70)
// that swaps cluster GeoJSON, re-renders headline cards, cost stack and tables.

const BUILD_TAG = "v4.1-2026-05-25d";

const COLORS = {
  densification: "#1f3a8a",
  extension:     "#60a5fa",
  shs:           "#fde047",
  remaining:     "#cbd5e1"
};
const LABELS = {
  densification: "Densification",
  extension:     "Extension",
  shs:           "SHS",
  remaining:     "Remaining"
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
  clusters: {},
  provincesAll: null,
  costStackAll: null,
  summary: null,
  meta: null,
  critique: null,
  adminGeoJSON: null,
  gridGeoJSON: null,
  map: null, clusterLayer: null, gridLayer: null, adminLayer: null,
  selectedProvince: "Luanda",
  pMap: null, pClusterLayer: null, pAdminLayer: null,
  provinceSort: { key: "plan_cost", dir: -1 }
};

function qsel(s)  { return document.querySelector(s); }
function qsela(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

function fmtMoney(n, digits) {
  if (digits == null) digits = 2;
  if (n == null || isNaN(n)) return "-";
  var a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(digits) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n);
}
function fmtNumber(n) {
  if (n == null || isNaN(n)) return "-";
  var a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return Math.round(n).toLocaleString();
}
function fmtPct(n, digits) {
  if (digits == null) digits = 1;
  if (n == null || isNaN(n)) return "-";
  return Number(n).toFixed(digits) + "%";
}

function setLoading(msg) {
  var el = document.getElementById("loading-overlay");
  if (!msg) { el.classList.add("hidden"); return; }
  document.getElementById("loading-msg").textContent = msg;
  el.classList.remove("hidden");
}
function showError(msg) {
  var el = document.getElementById("loading-overlay");
  el.classList.remove("hidden");
  document.getElementById("loading-msg").innerHTML =
    '<div style="max-width:560px;color:#dc2626;font-weight:600;">ERROR</div>' +
    '<div style="max-width:560px;margin-top:6px;font-size:12px;color:#475569;">' + msg + '</div>' +
    '<div style="max-width:560px;margin-top:12px;font-size:11px;color:#94a3b8;">Build ' + BUILD_TAG + '. Open DevTools console for stack trace.</div>';
}

async function loadStep(label, path) {
  setLoading(BUILD_TAG + " | " + label + "...");
  var r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error("HTTP " + r.status + " on " + path);
  var text = await r.text();
  if (!text || text.trim() === "") throw new Error("empty body from " + path);
  if (text.indexOf("version https://git-lfs.github.com") === 0) {
    throw new Error(path + " is a Git LFS pointer, not the actual file. Disable LFS for .geojson/.json or run: git lfs push --all origin main");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("invalid JSON in " + path + ": " + e.message);
  }
}

var osmA = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OSM" });
var satA = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "&copy; Esri" });
var osmP = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OSM" });
var satP = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: "&copy; Esri" });

function setBasemap(kind) {
  var m = state.page === "province" ? state.pMap : state.map;
  if (!m) return;
  var useOsm = kind === "osm";
  var o = m === state.map ? osmA : osmP;
  var s = m === state.map ? satA : satP;
  if (useOsm) { if (m.hasLayer(s)) m.removeLayer(s); if (!m.hasLayer(o)) o.addTo(m); }
  else        { if (m.hasLayer(o)) m.removeLayer(o); if (!m.hasLayer(s)) s.addTo(m); }
  state.basemap = kind;
}

function initOverviewMap() {
  state.map = L.map("map", { preferCanvas: true, renderer: L.canvas() }).setView([-12.5, 17.5], 6);
  osmA.addTo(state.map);
}

function clusterRadius(lbl) {
  if (lbl === "extension") return 4.5;
  if (lbl === "densification") return 3.5;
  if (lbl === "remaining") return 1.5;
  return 2.5;
}

function buildClusterLayer() {
  if (state.clusterLayer) state.map.removeLayer(state.clusterLayer);
  var gj = state.clusters[state.scenario];
  if (!gj) return;
  var order = ["remaining", "shs", "extension", "densification"];
  var feats = gj.features.slice().sort(function (a, b) {
    return order.indexOf(a.properties.lbl) - order.indexOf(b.properties.lbl);
  });
  state.clusterLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    pointToLayer: function (f, latlng) {
      return L.circleMarker(latlng, {
        radius: clusterRadius(f.properties.lbl),
        fillColor: COLORS[f.properties.lbl] || "#999",
        color: COLORS[f.properties.lbl] || "#999",
        weight: 0,
        fillOpacity: f.properties.lbl === "remaining" ? 0.4 : 0.85,
        stroke: false
      });
    },
    onEachFeature: function (f, layer) {
      var p = f.properties;
      layer.on("click", function () {
        var html =
          '<div class="cluster-popup">' +
          '<div class="row"><span class="k">Cluster id</span><span class="v">' + p.id + '</span></div>' +
          '<div class="row"><span class="k">Province</span><span class="v">' + p.p + '</span></div>' +
          '<div class="row"><span class="k">Pop 2030</span><span class="v">' + fmtNumber(p.pop) + '</span></div>' +
          '<div class="row"><span class="k">Category</span><span class="v">' + LABELS[p.lbl] + '</span></div>' +
          '<div class="row"><span class="k">Connections (plan)</span><span class="v">' + fmtNumber(p.conns) + '</span></div>' +
          '<div class="row"><span class="k">Cost (plan)</span><span class="v">' + fmtMoney(p.cost) + '</span></div>' +
          '</div>';
        layer.bindPopup(html).openPopup();
      });
    }
  });
  state.clusterLayer.addTo(state.map);
  applyCatVisibility();
}

function applyCatVisibility() {
  if (!state.clusterLayer) return;
  state.clusterLayer.eachLayer(function (layer) {
    var lbl = layer.feature.properties.lbl;
    var vis = state.catVisible[lbl];
    layer.setStyle({
      radius: vis ? clusterRadius(lbl) : 0,
      fillOpacity: vis ? (lbl === "remaining" ? 0.4 : 0.85) : 0
    });
  });
}

function buildGridLayer() {
  if (state.gridLayer) state.map.removeLayer(state.gridLayer);
  state.gridLayer = L.geoJSON(state.gridGeoJSON, {
    style: function (f) {
      var v = f.properties.VOLTAGE_KV || 0;
      var status = (f.properties.STATUS || "").toLowerCase();
      var colour = v >= 220 ? "#dc2626" : v >= 132 ? "#ea580c" : "#9333ea";
      var dashed = status.indexOf("construction") >= 0 || status.indexOf("planned") >= 0;
      return { color: colour, weight: 1.8, opacity: 0.85, dashArray: dashed ? "4,4" : null };
    },
    onEachFeature: function (f, l) {
      var p = f.properties;
      l.bindTooltip(p.FROM_NM + " > " + p.TO_NM + " (" + p.VOLTAGE_KV + "kV, " + p.STATUS + ")");
    }
  });
  if (state.showGrid) state.gridLayer.addTo(state.map);
}

function buildAdminLayer() {
  if (state.adminLayer) state.map.removeLayer(state.adminLayer);
  state.adminLayer = L.geoJSON(state.adminGeoJSON, {
    style: { color: "#475569", weight: 1, fillOpacity: 0.04, fillColor: "#94a3b8" },
    onEachFeature: function (f, l) {
      l.bindTooltip(f.properties.province, { sticky: true, direction: "center" });
    }
  });
  if (state.showAdmin) state.adminLayer.addTo(state.map);
}

function renderHeadline() {
  var h = state.summary.headline[state.scenario];
  var cards = [
    ["Total cost",      fmtMoney(h.total_cost_b * 1e9, 2), true],
    ["Connections",     fmtNumber(h.total_conn_m * 1e6), false],
    ["Access 2030",     fmtPct(h.target_pct), false],
    ["Grid cost share", fmtPct(h.grid_cost_share_pct), false],
    ["Densification",   fmtMoney(h.densification_cost_m * 1e6, 1), false],
    ["SHS cost",        fmtMoney(h.shs_cost_m * 1e6, 1), false]
  ];
  var wrap = document.getElementById("headline-cards");
  wrap.innerHTML = "";
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var div = document.createElement("div");
    div.className = "card" + (c[2] ? " highlight" : "");
    div.innerHTML = '<div class="label">' + c[0] + '</div><div class="value">' + c[1] + '</div>';
    wrap.appendChild(div);
  }
}

function shortRowName(s) {
  return s.replace("Densification (existing-grid expansion)", "Densification")
          .replace("Extension (new MV/LV grid)", "Extension")
          .replace("Programme overhead (staged delivery)", "Programme overhead");
}

function renderCostStack(target, source) {
  if (!target) target = "#cost-stack";
  var rowsAll = source || state.costStackAll[state.scenario];
  var rows = rowsAll.filter(function (r) { return String(r.row).indexOf("TOTAL") < 0; });
  var wrap = document.querySelector(target);
  wrap.innerHTML = "";
  var max = 1;
  for (var i = 0; i < rows.length; i++) if (rows[i].cost_usd_M > max) max = rows[i].cost_usd_M;
  var palette = {
    "Densification (existing-grid expansion)": COLORS.densification,
    "Extension (new MV/LV grid)": COLORS.extension,
    "SHS": COLORS.shs,
    "Programme overhead (staged delivery)": "#94a3b8"
  };
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    var w = Math.max(2, (r.cost_usd_M / max) * 100);
    var row = document.createElement("div");
    row.className = "stack-row";
    row.innerHTML =
      '<div class="stack-bar" style="width:' + w + '%; background:' + (palette[r.row] || "#888") + '"></div>' +
      '<div class="stack-label" title="' + r.row + '">' + shortRowName(r.row) + '</div>' +
      '<div class="stack-value">' + fmtMoney(r.cost_usd_M * 1e6, 1) + '</div>';
    wrap.appendChild(row);
  }
}

function renderCostTable() {
  var rows = state.costStackAll[state.scenario];
  var tbody = document.querySelector("#cost-table tbody");
  tbody.innerHTML = "";
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var tr = document.createElement("tr");
    var isTotal = String(r.row).indexOf("TOTAL") >= 0;
    var dpc = r.connections > 0 ? (r.cost_usd_M * 1e6) / r.connections : null;
    tr.innerHTML =
      '<td style="' + (isTotal ? "font-weight:700" : "") + '">' + r.row + '</td>' +
      '<td>' + fmtNumber(r.connections) + '</td>' +
      '<td>' + r.cost_usd_M.toFixed(1) + '</td>' +
      '<td>' + (dpc ? fmtMoney(dpc, 0) : "-") + '</td>';
    tbody.appendChild(tr);
  }
}

function renderProvinceTable() {
  var rows = state.provincesAll.filter(function (p) { return p.scenario === state.scenario; });
  var tbody = document.querySelector("#province-table tbody");
  tbody.innerHTML = "";
  var sorted = rows.slice().sort(function (a, b) {
    var x = a[state.provinceSort.key], y = b[state.provinceSort.key];
    if (typeof x === "string") return state.provinceSort.dir * x.localeCompare(y);
    return state.provinceSort.dir * ((x || 0) - (y || 0));
  });
  var target = state.summary.headline[state.scenario].target_pct;
  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    var tr = document.createElement("tr");
    var cls = p.access_2030_pct >= target ? "access-met" : "access-short";
    tr.innerHTML =
      '<td>' + p.Admin1_n + '</td>' +
      '<td>' + fmtNumber(p.in_plan_clusters) + '</td>' +
      '<td>' + fmtNumber(p.plan_conns) + '</td>' +
      '<td>' + (p.plan_cost / 1e6).toFixed(1) + '</td>' +
      '<td>' + ((p.densif_cost || 0) / 1e6).toFixed(1) + '</td>' +
      '<td>' + ((p.extension_cost || 0) / 1e6).toFixed(1) + '</td>' +
      '<td>' + ((p.shs_cost || 0) / 1e6).toFixed(1) + '</td>' +
      '<td class="' + cls + '">' + fmtPct(p.access_2030_pct) + '</td>';
    tbody.appendChild(tr);
  }
}

function renderCompareTable() {
  var H = state.summary.headline;
  function cpc(sc) {
    return "$" + Math.round(H[sc].total_cost_b * 1e9 / (H[sc].total_conn_m * 1e6)).toLocaleString();
  }
  var rows = [
    ["Total cost",         "$4.6B",    fmtMoney(H.S53.total_cost_b * 1e9, 2), fmtMoney(H.S60.total_cost_b * 1e9, 2), fmtMoney(H.S70.total_cost_b * 1e9, 2)],
    ["New connections",    "1.7M",     fmtNumber(H.S53.total_conn_m * 1e6),   fmtNumber(H.S60.total_conn_m * 1e6),   fmtNumber(H.S70.total_conn_m * 1e6)],
    ["$/connection (avg)", "~$2,700",  cpc("S53"), cpc("S60"), cpc("S70")],
    ["Grid cost share",    "n/a",      fmtPct(H.S53.grid_cost_share_pct), fmtPct(H.S60.grid_cost_share_pct), fmtPct(H.S70.grid_cost_share_pct)],
    ["Grid conn share",    "n/a",      fmtPct(H.S53.grid_conn_share_pct), fmtPct(H.S60.grid_conn_share_pct), fmtPct(H.S70.grid_conn_share_pct)]
  ];
  var tbody = document.querySelector("#compare-table tbody");
  tbody.innerHTML = "";
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var tr = document.createElement("tr");
    tr.innerHTML = '<td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td>';
    tbody.appendChild(tr);
  }
}

function initProvincePage() {
  state.pMap = L.map("province-map", { preferCanvas: true, renderer: L.canvas() }).setView([-12.5, 17.5], 6);
  osmP.addTo(state.pMap);
  var sel = document.getElementById("province-select");
  sel.innerHTML = "";
  var names = state.provincesAll.map(function (p) { return p.Admin1_n; });
  var uniq = names.filter(function (n, i) { return names.indexOf(n) === i; }).sort();
  for (var i = 0; i < uniq.length; i++) {
    var o = document.createElement("option");
    o.value = uniq[i];
    o.textContent = uniq[i];
    sel.appendChild(o);
  }
  sel.value = state.selectedProvince;
  sel.addEventListener("change", function () {
    state.selectedProvince = sel.value;
    renderProvinceView();
  });
  renderProvinceView();
}

function renderProvinceView() {
  var rows = state.provincesAll.filter(function (p) { return p.scenario === state.scenario; });
  var prov = rows.find(function (p) { return p.Admin1_n === state.selectedProvince; });
  if (!prov) return;
  var wrap = document.getElementById("province-cards");
  wrap.innerHTML = "";
  var targetPct = state.summary.headline[state.scenario].target_pct;
  var cards = [
    ["Pop 2030", fmtNumber(prov.pop_2030), ""],
    ["Already electrified", fmtNumber(prov.elec_2025), ""],
    ["Plan connections", fmtNumber(prov.plan_conns), ""],
    ["Plan cost", fmtMoney(prov.plan_cost, 1), ""],
    ["Access 2030", fmtPct(prov.access_2030_pct), prov.access_2030_pct >= targetPct ? "highlight" : ""]
  ];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var d = document.createElement("div");
    d.className = "card" + (c[2] ? " " + c[2] : "");
    d.innerHTML = '<div class="label">' + c[0] + '</div><div class="value">' + c[1] + '</div>';
    wrap.appendChild(d);
  }
  var bwrap = document.getElementById("province-breakdown");
  bwrap.innerHTML = "";
  var b = [
    ["Densification", prov.densification_clusters || 0],
    ["Extension",     prov.extension_clusters || 0],
    ["SHS",           prov.shs_clusters || 0]
  ];
  for (var j = 0; j < b.length; j++) {
    var d2 = document.createElement("div");
    d2.className = "card";
    d2.innerHTML = '<div class="label">' + b[j][0] + '</div><div class="value">' + fmtNumber(b[j][1]) + '</div>';
    bwrap.appendChild(d2);
  }
  var provCostStack = [
    { row: "Densification (existing-grid expansion)", connections: prov.densification_clusters, cost_usd_M: (prov.densif_cost || 0) / 1e6 },
    { row: "Extension (new MV/LV grid)",              connections: prov.extension_clusters,     cost_usd_M: (prov.extension_cost || 0) / 1e6 },
    { row: "SHS",                                     connections: prov.shs_clusters,           cost_usd_M: (prov.shs_cost || 0) / 1e6 }
  ];
  renderCostStack("#province-cost-stack", provCostStack);
  renderProvinceMap(prov);
}

function renderProvinceMap(prov) {
  if (state.pClusterLayer) state.pMap.removeLayer(state.pClusterLayer);
  if (state.pAdminLayer)   state.pMap.removeLayer(state.pAdminLayer);
  var pgon = state.adminGeoJSON.features.find(function (f) { return f.properties.province === prov.Admin1_n; });
  if (pgon) {
    state.pAdminLayer = L.geoJSON(pgon, {
      style: { color: "#1f3a8a", weight: 2, fillColor: "#94c5fb", fillOpacity: 0.05 }
    }).addTo(state.pMap);
    state.pMap.fitBounds(state.pAdminLayer.getBounds(), { padding: [20, 20] });
  }
  var gj = state.clusters[state.scenario];
  if (!gj) return;
  var feats = gj.features.filter(function (f) { return f.properties.p === prov.Admin1_n; });
  state.pClusterLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    pointToLayer: function (f, latlng) {
      return L.circleMarker(latlng, {
        radius: f.properties.lbl === "extension" ? 6 : f.properties.lbl === "densification" ? 4.5 : 3,
        fillColor: COLORS[f.properties.lbl] || "#999",
        color: COLORS[f.properties.lbl] || "#999",
        weight: 0,
        fillOpacity: state.pCatVisible[f.properties.lbl] ? 0.85 : 0,
        stroke: false
      });
    }
  }).addTo(state.pMap);
}

function renderCritique() {
  var tbody = document.querySelector("#critique-table tbody");
  tbody.innerHTML = "";
  for (var i = 0; i < state.critique.length; i++) {
    var r = state.critique[i];
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td>' + r.weakness + '</td>' +
      '<td>' + r.compact_value + '</td>' +
      '<td>' + r.reconciled_value + '</td>' +
      '<td>' + r.source_basis + '</td>';
    tbody.appendChild(tr);
  }
}

function renderFooter() {
  document.getElementById("footer-data-version").textContent = state.meta.data_version;
  document.getElementById("footer-build-date").textContent   = state.meta.build_date;
  document.getElementById("footer-timestamp").textContent    = state.meta.run_timestamp.split("T")[0];
  document.getElementById("footer-src").textContent          = state.meta.src_file;
}

async function setScenario(sc, pushURL) {
  if (pushURL == null) pushURL = true;
  if (sc === state.scenario && state.clusters[sc]) return;
  state.scenario = sc;
  var btns = qsela(".scenario-switch button");
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].dataset.sc === sc;
    btns[i].classList.toggle("active", on);
    btns[i].setAttribute("aria-selected", on ? "true" : "false");
  }
  if (!state.clusters[sc]) {
    state.clusters[sc] = await loadStep(sc + " clusters (~7 MB)", "data/clusters_" + sc + ".geojson");
    setLoading(null);
  }
  renderHeadline();
  renderCostStack();
  renderCostTable();
  renderProvinceTable();
  buildClusterLayer();
  if (state.page === "province") renderProvinceView();
  if (pushURL) {
    var u = new URL(location.href);
    u.searchParams.set("scenario", sc);
    history.replaceState({}, "", u);
  }
}

function wireControls() {
  document.getElementById("sidebar-toggle").addEventListener("click", function () {
    document.getElementById("sidebar").classList.toggle("closed");
    setTimeout(function () { state.map.invalidateSize(); }, 250);
  });
  document.getElementById("province-sidebar-toggle").addEventListener("click", function () {
    document.getElementById("province-sidebar").classList.toggle("closed");
    setTimeout(function () { if (state.pMap) state.pMap.invalidateSize(); }, 250);
  });
  document.getElementById("bottom-toggle").addEventListener("click", function () {
    document.getElementById("bottom-panel").classList.toggle("closed");
    setTimeout(function () { state.map.invalidateSize(); }, 250);
  });
  var pageTabs = qsela(".page-tab");
  for (var i = 0; i < pageTabs.length; i++) (function (b) {
    b.addEventListener("click", function () { switchPage(b.dataset.page); });
  })(pageTabs[i]);
  var bottomBtns = qsela(".bottom-tabs button");
  for (var k = 0; k < bottomBtns.length; k++) (function (b) {
    b.addEventListener("click", function () {
      for (var j = 0; j < bottomBtns.length; j++) bottomBtns[j].classList.toggle("active", bottomBtns[j] === b);
      var panes = qsela(".tab-pane");
      for (var n = 0; n < panes.length; n++) panes[n].classList.toggle("hidden", panes[n].dataset.pane !== b.dataset.tab);
    });
  })(bottomBtns[k]);
  document.getElementById("basemap-select").addEventListener("change", function (e) { setBasemap(e.target.value); });
  var cats = qsela(".cat-toggle");
  for (var c1 = 0; c1 < cats.length; c1++) (function (cb) {
    cb.addEventListener("change", function () {
      state.catVisible[cb.dataset.cat] = cb.checked;
      applyCatVisibility();
    });
  })(cats[c1]);
  var pcats = qsela(".pcat-toggle");
  for (var c2 = 0; c2 < pcats.length; c2++) (function (cb) {
    cb.addEventListener("change", function () {
      state.pCatVisible[cb.dataset.cat] = cb.checked;
      var rows = state.provincesAll.filter(function (p) { return p.scenario === state.scenario; });
      var prov = rows.find(function (p) { return p.Admin1_n === state.selectedProvince; });
      if (prov) renderProvinceMap(prov);
    });
  })(pcats[c2]);
  document.getElementById("lyr-grid").addEventListener("change", function (e) {
    state.showGrid = e.target.checked;
    if (state.showGrid) state.gridLayer.addTo(state.map); else state.map.removeLayer(state.gridLayer);
  });
  document.getElementById("lyr-admin").addEventListener("change", function (e) {
    state.showAdmin = e.target.checked;
    if (state.showAdmin) state.adminLayer.addTo(state.map); else state.map.removeLayer(state.adminLayer);
  });
  var ths = qsela("#province-table thead th");
  for (var t = 0; t < ths.length; t++) (function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.sort; if (!key) return;
      state.provinceSort.dir = state.provinceSort.key === key ? -state.provinceSort.dir : -1;
      state.provinceSort.key = key;
      renderProvinceTable();
    });
  })(ths[t]);
  var scBtns = qsela(".scenario-switch button");
  for (var s2 = 0; s2 < scBtns.length; s2++) (function (b) {
    b.addEventListener("click", function () { setScenario(b.dataset.sc); });
  })(scBtns[s2]);
}

function switchPage(name) {
  state.page = name;
  var pageTabs = qsela(".page-tab");
  for (var i = 0; i < pageTabs.length; i++) pageTabs[i].classList.toggle("active", pageTabs[i].dataset.page === name);
  var pages = qsela(".page");
  for (var j = 0; j < pages.length; j++) pages[j].classList.toggle("active", pages[j].id === "page-" + name);
  if (name === "overview") setTimeout(function () { state.map.invalidateSize(); }, 100);
  else if (name === "province") {
    if (!state.pMap) initProvincePage();
    else setTimeout(function () { state.pMap.invalidateSize(); }, 100);
  }
}

async function init() {
  console.log("Angola Electrification dashboard " + BUILD_TAG);
  try { initOverviewMap(); }
  catch (e) { showError("Map init failed: " + e.message); throw e; }

  var urlSc = new URLSearchParams(location.search).get("scenario");
  if (urlSc && SCENARIOS.indexOf(urlSc) >= 0) state.scenario = urlSc;

  state.summary      = await loadStep("summary",     "data/summary.json");
  state.costStackAll = await loadStep("cost_stack",  "data/cost_stack.json");
  state.provincesAll = await loadStep("provinces",   "data/provinces.json");
  state.meta         = await loadStep("meta",        "data/meta.json");
  state.critique     = await loadStep("critique",    "data/critique.json");
  state.adminGeoJSON = await loadStep("admin1",      "data/admin1.geojson");
  state.gridGeoJSON  = await loadStep("grid",        "data/existing_grid.geojson");

  var scBtns = qsela(".scenario-switch button");
  for (var i = 0; i < scBtns.length; i++) {
    scBtns[i].classList.toggle("active", scBtns[i].dataset.sc === state.scenario);
  }

  setLoading(BUILD_TAG + " | rendering panels...");
  renderHeadline();
  renderCostStack();
  renderCostTable();
  renderProvinceTable();
  renderCompareTable();
  renderCritique();
  renderFooter();
  buildAdminLayer();
  buildGridLayer();

  state.clusters[state.scenario] = await loadStep(state.scenario + " clusters (~7 MB)", "data/clusters_" + state.scenario + ".geojson");
  setLoading(BUILD_TAG + " | rendering clusters...");
  buildClusterLayer();
  wireControls();
  setLoading(null);
  console.log("dashboard ready");
}

init().catch(function (err) {
  console.error(err);
  showError(err && err.message ? err.message : String(err));
});
