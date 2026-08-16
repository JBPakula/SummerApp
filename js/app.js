// js/app.js

// ==============================================================================
// 0. KONFIGURACJA I ZMIENNE GLOBALNE
// ==============================================================================
const SUPABASE_URL = "https://mkysisoznxgssakcegbn.supabase.co";
const SUPABASE_KEY = "sb_publishable_4lljAeNc5dvmsJG2u1-pgQ_zCnATIE1";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LICZBA_OSOB_W_EKIPIE = { "Całe Stado": 15, "Bobry": 3, "Pakuły": 4, "Robaki": 4, "Sileziny": 4 };
const DOM_LAT = 47.868557;
const DOM_LNG = 20.331627;

let currentUser = null;
let currentUserId = null;
let currentTeam = "Pakuły";
let currentMode = "Na wyjeździe";

let bazaKursow = {
  "PLN_HUF": 85.20, "HUF_PLN": 0.0117,
  "PLN_EUR": 0.23,  "EUR_PLN": 4.32,
  "EUR_HUF": 368.0, "HUF_EUR": 0.0027,
  "PLN_PLN": 1.0,   "HUF_HUF": 1.0, "EUR_EUR": 1.0
};
let malzenstwaMapa = {};
let ekipyMapa = {};

// Zmienne modułu Mapy
let mapInstance = null;
let mapMarkersGroup = null;
let radarMarkersGroup = null;
let myGpsMarker = null;
let radarIntervalId = null;
let isRadarActive = false;
let mapPointsData = [];

// Zmienne modułu Forum
let currentTopicId = null;
let currentTopicIsArchived = false;
let forumUsersMap = {};
let forumUserLogins = [];
let forumRealtimeChannel = null;

// ==============================================================================
// 0.1 INICJALIZACJA I OBSŁUGA SESJI
// ==============================================================================
async function initApp() {
  await pobierzKursyWalut();
  await pobierzUzytkownikowIMalzenstwa();
  await checkAuth();
  setupEventListeners();
  initForumRealtime();
  attachMentionHighlighter("newTopicFirstPost");
  attachMentionHighlighter("forumPostEditor");

  if (currentUser) {
    const lastTab = localStorage.getItem("active_tab") || "dashboard";
    switchTab(lastTab);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

async function pobierzKursyWalut() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=PLN,HUF");
    const dane = await res.json();
    if (dane && dane.rates) {
      const eurPln = dane.rates.PLN;
      const eurHuf = dane.rates.HUF;

      bazaKursow = {
        "PLN_HUF": eurHuf / eurPln, "HUF_PLN": eurPln / eurHuf,
        "PLN_EUR": 1 / eurPln,      "EUR_PLN": eurPln,
        "EUR_HUF": eurHuf,          "HUF_EUR": 1 / eurHuf,
        "PLN_PLN": 1.0,             "HUF_HUF": 1.0, "EUR_EUR": 1.0
      };
    }
  } catch (e) {
    console.warn("Używam domyślnych kursów walut:", e);
  }
}

async function pobierzUzytkownikowIMalzenstwa() {
  const dataList = document.getElementById("userSuggestions");
  if (dataList) dataList.innerHTML = "";

  try {
    const { data } = await supabaseClient.from("users").select("id, login, team, spouse_id").order("login");
    if (data) {
      const idToLogin = {};
      data.forEach(u => {
        idToLogin[u.id] = u.login;
        ekipyMapa[u.login] = u.team || "Pakuły";

        if (dataList) {
          const opt = document.createElement("option");
          opt.value = u.login;
          dataList.appendChild(opt);
        }
      });

      data.forEach(u => {
        if (u.spouse_id && idToLogin[u.spouse_id]) {
          malzenstwaMapa[u.login] = idToLogin[u.spouse_id];
        }
      });
    }
  } catch (err) {
    console.error("Błąd pobierania użytkowników:", err);
  }
}

async function checkAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const paramUser = urlParams.get("user") || urlParams.get("uzytkownik");
  const paramToken = urlParams.get("token") || urlParams.get("haslo");

  const userToCheck = paramUser || localStorage.getItem("stado_user");
  const tokenToCheck = paramToken || localStorage.getItem("stado_token");

  if (userToCheck && tokenToCheck) {
    const success = await verifyAndLogin(userToCheck, tokenToCheck);
    if (!success) pokazEkranLogowania();
  } else {
    pokazEkranLogowania();
  }
}

async function verifyAndLogin(userName, password) {
  try {
    const { data, error } = await supabaseClient.rpc("login_user", {
      p_login: userName.trim(),
      p_passcode: password.trim()
    });

    if (error || !data || data.length === 0) {
      return false;
    }

    const userData = data[0];
    currentUser = userData.login;
    currentUserId = userData.id;
    currentTeam = userData.team || "Pakuły";

    localStorage.setItem("stado_user", currentUser);
    localStorage.setItem("stado_token", password.trim());

    document.getElementById("loginSection").style.display = "none";
    document.getElementById("appSection").style.display = "block";
    
    const welcomeEl = document.getElementById("welcomeUserName");
    if (welcomeEl) welcomeEl.innerText = currentUser;

    const dashAvatarEl = document.getElementById("dashboardUserAvatar");
    const extensions = ["jpg", "jpeg", "png"];
    let extIndex = 0;

    function tryLoadAvatar() {
      if (extIndex < extensions.length) {
        const src = `assets/avatars/${currentUser}.${extensions[extIndex]}`;
        if (dashAvatarEl) dashAvatarEl.src = src;
        extIndex++;
      } else {
        const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser)}&background=8B0000&color=fff&size=128&bold=true`;
        if (dashAvatarEl) {
          dashAvatarEl.onerror = null;
          dashAvatarEl.src = fallbackUrl;
        }
      }
    }

    if (dashAvatarEl) dashAvatarEl.onerror = tryLoadAvatar;
    tryLoadAvatar();

    renderDashboardDate();
    initMap();
    loadCosts();

    const savedTab = localStorage.getItem("active_tab") || "dashboard";
    switchTab(savedTab);
    return true;
  } catch (e) {
    console.error("Wyjątek podczas autoryzacji:", e);
    return false;
  }
}

function pokazEkranLogowania() {
  document.getElementById("loginSection").style.display = "block";
  document.getElementById("appSection").style.display = "none";
}

document.getElementById("btnLogin").addEventListener("click", async () => {
  const user = document.getElementById("loginUsernameInput").value.trim();
  const pass = document.getElementById("loginPasswordInput").value.trim();
  const err = document.getElementById("loginError");

  if (!user || !pass) {
    err.innerText = "❌ Wpisz login oraz hasło!";
    err.style.display = "block";
    return;
  }

  err.style.display = "none";
  const success = await verifyAndLogin(user, pass);
  if (!success) {
    err.innerText = "❌ Nieprawidłowy login lub hasło!";
    err.style.display = "block";
  }
});

document.getElementById("btnLogout").addEventListener("click", () => {
  localStorage.clear();
  window.location.href = window.location.pathname;
});

// ==============================================================================
// 0.2 NAWIGACJA (SWITCHTAB) I WIDŻET PULPITU
// ==============================================================================
function renderDashboardDate() {
  const container = document.getElementById("dashboardDateBox");
  if (!container) return;

  const now = new Date();
  const day = now.getDate();
  const months = [
    "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
    "lipca", "sierpnia", "września", "października", "listopada", "grudnia"
  ];
  const weekdays = [
    "niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"
  ];

  const dateFormatted = `${day} ${months[now.getMonth()]}`;
  const weekdayFormatted = weekdays[now.getDay()];

  const targetDate = new Date(2026, 7, 19);
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.ceil((targetDate - todayOnly) / (1000 * 60 * 60 * 24));

  let countdownHtml = "";
  if (diffDays > 0) {
    let textDni = "dni";
    if (diffDays === 1) textDni = "dzień";
    countdownHtml = `<div class="fw-bold" style="color: var(--burgund); font-size: 0.78rem;">⏳ ${diffDays} ${textDni} do wyjazdu</div>`;
  }

  container.innerHTML = `
    <div class="fw-bold text-dark">${dateFormatted}</div>
    <div class="text-muted small">${weekdayFormatted}</div>
    ${countdownHtml}
  `;

  checkForumUnreadNotifications();
}

function switchTab(tabName) {
  localStorage.setItem("active_tab", tabName);

  document.querySelectorAll(".app-tab").forEach(el => el.style.display = "none");

  if (tabName === "dashboard" || tabName.includes("Pulpit")) {
    document.getElementById("tab-dashboard").style.display = "block";
    renderDashboardDate();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (tabName.includes("Mapa")) {
    document.getElementById("tab-map").style.display = "block";
    loadMapData();
    if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 200);
  } else if (tabName.includes("Forum")) {
    document.getElementById("tab-forum").style.display = "block";
    showTopicsList();
  } else if (tabName.includes("Wydatki")) {
    document.getElementById("tab-costs").style.display = "block";
    loadCosts();
  } else if (tabName.includes("Zakupy")) {
    document.getElementById("tab-shopping").style.display = "block";
    loadShoppingLists();
  } else if (tabName.includes("Kantor")) {
    document.getElementById("tab-exchange").style.display = "block";
    przeliczKantor();
  } else if (tabName.includes("Portfel")) {
    document.getElementById("tab-wallet").style.display = "block";
    loadWallet();
  } else if (tabName.includes("bilety") || tabName.includes("Bilety") || tabName.includes("Płacimy") || tabName === "calc") {
    const tabCalc = document.getElementById("tab-calc");
    if (tabCalc) {
      tabCalc.style.display = "block";
      przeliczBilety();
    }
  } else if (tabName.includes("Rozgrywki") || tabName === "games") {
    document.getElementById("tab-games").style.display = "block";
    loadGames();
  }
}

// ==============================================================================
// 1. MODUŁ: MAPA (Z GPS, RADAREM I MODALEM DODAWANIA)
// ==============================================================================
function getCategoryPinIcon(category, number) {
  let pinClass = 'pin-inne';
  const cat = (category || '').toLowerCase();
  
  if (cat.includes('dom')) {
    return L.divIcon({
      className: 'custom-pin-wrapper',
      html: `<div class="custom-pin pin-dom" style="width: 32px; height: 32px; font-size: 15px;">🏠</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16]
    });
  }
  
  if (cat.includes('term')) pinClass = 'pin-termy';
  else if (cat.includes('zwiedzanie') || cat.includes('zabytek') || cat.includes('atrakcj')) pinClass = 'pin-zwiedzanie';
  else if (cat.includes('jedzenie') || cat.includes('wino') || cat.includes('restaurac')) pinClass = 'pin-jedzenie';

  return L.divIcon({
    className: 'custom-pin-wrapper',
    html: `<div class="custom-pin ${pinClass}" style="width: 28px; height: 28px;">#${number}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function initMap() {
  if (mapInstance) return;

  const container = document.getElementById('mapContainer');
  if (!container) return;

  mapInstance = L.map('mapContainer').setView([DOM_LAT, DOM_LNG], 13);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(mapInstance);

  mapMarkersGroup = L.layerGroup().addTo(mapInstance);
  radarMarkersGroup = L.layerGroup().addTo(mapInstance);

  // Przycisk globusa pod kontrolkami zoomu (+ / -)
  const fitControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const link = L.DomUtil.create('a', '', container);
      link.href = '#';
      link.title = 'Pokaż wszystkie widoczne punkty';
      link.innerHTML = '🌐';
      link.style.fontSize = '14px';
      link.style.display = 'flex';
      link.style.alignItems = 'center';
      link.style.justifyContent = 'center';
      link.style.cursor = 'pointer';

      link.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        fitAllMarkers();
      };
      return container;
    }
  });
  mapInstance.addControl(new fitControl());

  // Kliknięcie na mapie otwiera czysty modal dodawania z wyborem kategorii
  mapInstance.on('click', (e) => {
    const { lat, lng } = e.latlng;
    document.getElementById("newPointLat").value = lat;
    document.getElementById("newPointLng").value = lng;
    document.getElementById("newPointName").value = "";
    document.getElementById("newPointAddress").value = "";
    document.getElementById("newPointCategory").value = "Zwiedzanie";

    const modalEl = document.getElementById("modalAddMapPoint");
    if (modalEl) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  });

  setupMapButtons();
}

// Obsługa zapisu z modala
const formAddMapPoint = document.getElementById("formAddMapPoint");
if (formAddMapPoint) {
  formAddMapPoint.onsubmit = async (e) => {
    e.preventDefault();
    const lat = parseFloat(document.getElementById("newPointLat").value);
    const lng = parseFloat(document.getElementById("newPointLng").value);
    const name = document.getElementById("newPointName").value.trim();
    const category = document.getElementById("newPointCategory").value;
    const address = document.getElementById("newPointAddress").value.trim();

    if (!name || isNaN(lat) || isNaN(lng)) return;

    const { error } = await supabaseClient.from("map").insert({
      name: name,
      category: category,
      address: address,
      lat: lat,
      lng: lng,
      created_by: currentUserId
    });

    const modalEl = document.getElementById("modalAddMapPoint");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    if (!error) {
      await loadMapData();
    } else {
      alert("Błąd zapisu punktu: " + error.message);
    }
  };
}

function fitAllMarkers() {
  if (!mapInstance || !mapMarkersGroup) return;
  const layers = mapMarkersGroup.getLayers();
  if (layers.length === 0) return;

  const group = L.featureGroup(layers);
  mapInstance.fitBounds(group.getBounds().pad(0.15), { animate: true, duration: 1.0 });
}

async function loadMapData() {
  initMap();
  if (mapMarkersGroup) mapMarkersGroup.clearLayers();

  const { data: points, error } = await supabaseClient
    .from("map")
    .select("*")
    .order("id", { ascending: true });

  if (error || !points) return;
  mapPointsData = points;

  // Domyślne filtrowanie na start: tylko Termy
 const initialFiltered = mapPointsData.filter(p => {
    const cat = (p.category || '').toLowerCase();
    return cat.includes('term') || cat.includes('dom');
  });
  renderMapMarkers(initialFiltered);
  renderMapList(initialFiltered);
}

function renderMapMarkers(points) {
  if (!mapMarkersGroup) return;
  mapMarkersGroup.clearLayers();

  points.forEach((p, idx) => {
    if (!p.lat || !p.lng) return;
    const icon = getCategoryPinIcon(p.category, idx + 1);
    const marker = L.marker([p.lat, p.lng], { icon: icon });

    const photoHtml = p.photo ? `<img src="${p.photo}" style="width:100%; height:110px; object-fit:cover; border-radius:8px;" class="mb-2">` : '';
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    const webUrl = p.official_url ? `<a href="${p.official_url}" target="_blank" class="btn btn-sm btn-outline-secondary py-0 mt-1" style="font-size:11px;">Strona WWW</a>` : '';

    const popupContent = `
      <div style="min-width: 180px; max-width: 230px; font-family: sans-serif;">
        ${photoHtml}
        <b style="color:var(--burgund); font-size:13px;">${p.name}</b>
        <div class="text-muted small my-1" style="font-size:11px;">${p.address || ''}</div>
        <div class="d-flex justify-content-between align-items-center mt-2">
          <a href="${gmapsUrl}" target="_blank" class="btn btn-sm btn-danger py-0 px-2" style="font-size:11px; background:var(--burgund);">🚗 Jedź</a>
          ${webUrl}
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    mapMarkersGroup.addLayer(marker);
  });
}

function renderMapList(points) {
  const listContainer = document.getElementById("mapPlacesList");
  if (!listContainer) return;

  if (points.length === 0) {
    listContainer.innerHTML = "<div class='text-muted small'>Brak miejsc do wyświetlenia.</div>";
    return;
  }

  listContainer.innerHTML = points.map((p, idx) => {
    const isDom = (p.category || '').toLowerCase().includes('dom');
    const badgeNumber = isDom ? '🏠' : `#${idx + 1}`;
    
    return `
      <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center px-2 py-2" 
           style="cursor: pointer;" onclick="focusMapPoint(${p.lat}, ${p.lng})">
        <div>
          <span class="badge ${isDom ? 'bg-danger' : 'bg-light text-dark border'} me-1">${badgeNumber}</span>
          <b style="font-size: 0.9rem; color: var(--burgund);">${p.name}</b>
          <div class="text-muted small ps-4" style="font-size: 11px;">${p.category || 'Inne'} &bull; ${p.address || 'Egerszalók'}</div>
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </div>
    `;
  }).join("");
}

window.focusMapPoint = function(lat, lng) {
  if (!mapInstance) return;
  document.getElementById("mapContainer").scrollIntoView({ behavior: "smooth", block: "start" });
  mapInstance.flyTo([lat, lng], 16, { duration: 1.2 });
};

function setupMapButtons() {
  const btnHome = document.getElementById("btnCenterHome");
  if (btnHome) {
    btnHome.onclick = () => {
      if (mapInstance) {
        document.getElementById("mapContainer").scrollIntoView({ behavior: "smooth", block: "start" });
        mapInstance.flyTo([DOM_LAT, DOM_LNG], 15);
      }
    };
  }

  const btnGps = document.getElementById("btnMyLocation");
  if (btnGps) {
    btnGps.onclick = () => {
      if (!navigator.geolocation) {
        alert("Twoje urządzenie lub przeglądarka nie obsługuje geolokalizacji.");
        return;
      }

      btnGps.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Szukam...`;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btnGps.innerHTML = `<i class="bi bi-crosshair me-1"></i> Moja lokalizacja`;
          const { latitude, longitude } = pos.coords;

          if (myGpsMarker && mapInstance) mapInstance.removeLayer(myGpsMarker);

          const gpsIcon = L.divIcon({
            className: 'custom-pin-wrapper',
            html: `<div class="user-gps-pulse" title="Tu jesteś"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          });

          if (mapInstance) {
            myGpsMarker = L.marker([latitude, longitude], { icon: gpsIcon }).addTo(mapInstance);
            myGpsMarker.bindPopup("<b>📍 Twoja obecna pozycja</b>").openPopup();

            document.getElementById("mapContainer").scrollIntoView({ behavior: "smooth", block: "start" });
            mapInstance.flyTo([latitude, longitude], 16, { duration: 1.2 });
          }
        },
        (err) => {
          btnGps.innerHTML = `<i class="bi bi-crosshair me-1"></i> Moja lokalizacja`;
          alert("Nie udało się pobrać pozycji GPS: " + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };
  }

  const btnRadar = document.getElementById("btnToggleRadar");
  if (btnRadar) {
    btnRadar.onclick = () => {
      isRadarActive = !isRadarActive;
      const dot = document.getElementById("radarStatusDot");
      const text = document.getElementById("radarStatusText");

      if (isRadarActive) {
        btnRadar.classList.add("radar-active");
        if (dot) dot.className = "rounded-circle bg-success";
        if (text) text.innerHTML = `Radar Stada: <b>Nadawanie aktywne (co 30s)</b>`;
        sendAndFetchRadarLocations();
        radarIntervalId = setInterval(sendAndFetchRadarLocations, 30000);
      } else {
        btnRadar.classList.remove("radar-active");
        if (dot) dot.className = "rounded-circle bg-secondary";
        if (text) text.innerHTML = `Radar Stada w trasie: <b>Wyłączony</b>`;
        if (radarIntervalId) clearInterval(radarIntervalId);
        if (radarMarkersGroup) radarMarkersGroup.clearLayers();
      }
    };
  }

  const filterBadges = document.querySelectorAll("#mapFilterBadges button");
  filterBadges.forEach(btn => {
    btn.onclick = () => {
      filterBadges.forEach(b => {
        b.className = "btn btn-sm btn-outline-secondary px-2 py-1";
      });
      btn.className = "btn btn-sm btn-burgund px-2 py-1 active-filter";

      const cat = btn.getAttribute("data-cat");
      if (cat === "all") {
        renderMapMarkers(mapPointsData);
        renderMapList(mapPointsData);
      } else {
        // Zawsze dołączaj Dom do wybranej kategorii
        const filtered = mapPointsData.filter(p => {
          const itemCat = (p.category || '').toLowerCase();
          return itemCat.includes(cat.toLowerCase()) || itemCat.includes('dom');
        });
        renderMapMarkers(filtered);
        renderMapList(filtered);
      }
    };
  });

  const searchInput = document.getElementById("mapSearchInput");
  if (searchInput) {
    searchInput.oninput = (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = mapPointsData.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) || 
        (p.address && p.address.toLowerCase().includes(q)) || 
        (p.category && p.category.toLowerCase().includes(q))
      );
      renderMapMarkers(filtered);
      renderMapList(filtered);
    };
  }
}

async function sendAndFetchRadarLocations() {
  if (!navigator.geolocation || !currentUserId) return;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;

      await supabaseClient.from("user_locations").upsert({
        user_id: currentUserId,
        login: currentUser || "Anonim",
        team: currentTeam || "Stado",
        lat: latitude,
        lng: longitude,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: locations } = await supabaseClient
        .from("user_locations")
        .select("*")
        .neq("user_id", currentUserId)
        .gte("updated_at", twoHoursAgo);

      if (radarMarkersGroup) {
        radarMarkersGroup.clearLayers();

        if (locations) {
          locations.forEach(loc => {
            const diffMin = Math.round((Date.now() - new Date(loc.updated_at).getTime()) / 60000);
            const timeText = diffMin <= 1 ? "przed chwilą" : `${diffMin} min temu`;
            const cleanLogin = loc.login.trim();
            const avatarUrl = `assets/avatars/${cleanLogin}.jpg`;

            // Wewnątrz sendAndFetchRadarLocations() w pętli locations.forEach:
const cleanLogin = loc.login.trim();
const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanLogin)}&background=4A1525&color=fff&size=64`;

const carIcon = L.divIcon({
  className: 'custom-pin-wrapper',
  html: `
    <div class="radar-car-pin" style="width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--burgund); background: #FFFFFF; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.35);" title="${loc.login} (${loc.team})">
      <img src="assets/avatars/${cleanLogin}.jpg" 
           style="width: 100%; height: 100%; object-fit: cover;" 
           alt="${cleanLogin}"
           onerror="if(this.src.endsWith('.jpg')){ this.src='assets/avatars/${cleanLogin}.jpeg'; } else { this.onerror=null; this.src='${fallbackUrl}'; }">
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17]
});

            const marker = L.marker([loc.lat, loc.lng], { icon: carIcon });
            marker.bindPopup(`
              <div class="text-center p-1">
                <b style="color:var(--burgund);">${loc.login}</b> (${loc.team})<br>
                <span class="text-muted small" style="font-size:11px;">Aktualizacja: ${timeText}</span>
              </div>
            `);
            radarMarkersGroup.addLayer(marker);
          });
        }
      }
    },
    (err) => console.warn("Błąd GPS radaru:", err.message),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ==============================================================================
// 2. MODUŁ: FORUM DYSKUSYJNE
// ==============================================================================
function renderAvatarHtml(login) {
  if (!login) return `<span class="forum-avatar-placeholder me-2">👤</span>`;
  const cleanLogin = login.trim();
  const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanLogin)}&background=4A1525&color=fff&size=64`;

  return `
    <img src="assets/avatars/${cleanLogin}.jpg" 
         class="forum-avatar me-2" 
         alt="${cleanLogin}" 
         onerror="if(this.src.endsWith('.jpg')){ this.src='assets/avatars/${cleanLogin}.jpeg'; } else if(this.src.endsWith('.jpeg')){ this.src='assets/avatars/${cleanLogin}.png'; } else { this.onerror=null; this.src='${fallbackUrl}'; }">
  `;
}

function formatTopicDoc(cmd, value = null) {
  document.execCommand(cmd, false, value);
  const el = document.getElementById("newTopicFirstPost");
  if (el) el.focus();
}

function formatReplyDoc(cmd, value = null) {
  document.execCommand(cmd, false, value);
  const el = document.getElementById("forumPostEditor");
  if (el) el.focus();
}

async function pobierzUzytkownikowForum() {
  if (Object.keys(forumUsersMap).length === 0) {
    const { data: users } = await supabaseClient.from("users").select("id, login");
    if (users) {
      forumUserLogins = [];
      users.forEach(u => { 
        forumUsersMap[u.id] = u.login; 
        forumUserLogins.push(u.login);
      });
    }
  }
}

function parseMentionsInHtml(htmlText) {
  if (!htmlText) return "";
  let cleanText = htmlText.replace(/<span class="forum-mention-badge"[^>]*>(@\w+)<\/span>/gi, "$1");
  forumUserLogins.forEach(uLogin => {
    const regex = new RegExp(`@(${uLogin})\\b`, "gi");
    cleanText = cleanText.replace(regex, `<span class="forum-mention-badge">@$1</span>`);
  });
  return cleanText;
}

function attachMentionHighlighter(editorId) {
  const editor = document.getElementById(editorId);
  if (!editor) return;

  editor.addEventListener("blur", () => {
    if (!editor.innerHTML.includes('<span class="forum-mention-badge"')) {
      editor.innerHTML = parseMentionsInHtml(editor.innerHTML);
    }
  });
}

async function subscribeMentionedUsers(rawHtml, topicId) {
  const mentionedLogins = [];
  forumUserLogins.forEach(uLogin => {
    const regex = new RegExp(`@${uLogin}\\b`, "i");
    if (regex.test(rawHtml)) mentionedLogins.push(uLogin);
  });

  if (mentionedLogins.length === 0) return;

  const userIdsToSubscribe = Object.entries(forumUsersMap)
    .filter(([id, login]) => mentionedLogins.includes(login))
    .map(([id]) => parseInt(id, 10));

  for (const uId of userIdsToSubscribe) {
    if (uId !== currentUserId) {
      await supabaseClient.from("forum_subscriptions").upsert({
        topic_id: topicId,
        user_id: uId,
        is_subscribed: true,
        last_read_at: "1970-01-01T00:00:00.000Z"
      }, { onConflict: 'topic_id, user_id' });
    }
  }
}

async function checkForumUnreadNotifications() {
  if (!currentUserId) return;

  try {
    const { data: subs } = await supabaseClient
      .from("forum_subscriptions")
      .select("topic_id, last_read_at")
      .eq("user_id", currentUserId)
      .eq("is_subscribed", true);

    if (!subs || subs.length === 0) {
      updateForumBadge(0);
      return;
    }

    const topicIds = subs.map(s => s.topic_id);
    const { data: posts } = await supabaseClient
      .from("forum")
      .select("topic_id, created_at, created_by")
      .in("topic_id", topicIds)
      .neq("created_by", currentUserId)
      .eq("deleted", false);

    let unreadTopicsCount = 0;
    if (posts) {
      subs.forEach(s => {
        const lastReadTime = s.last_read_at ? new Date(s.last_read_at).getTime() : 0;
        const hasUnread = posts.some(p => p.topic_id === s.topic_id && new Date(p.created_at).getTime() > (lastReadTime + 1000));
        if (hasUnread) unreadTopicsCount++;
      });
    }

    updateForumBadge(unreadTopicsCount);
  } catch (err) {
    console.warn("Błąd sprawdzania powiadomień forum:", err);
  }
}

function updateForumBadge(count) {
  const badge = document.getElementById("dashboardForumBadge");
  if (!badge) return;

  if (count > 0) {
    badge.innerText = `● ${count} nowe`;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

function initForumRealtime() {
  if (forumRealtimeChannel) return;

  forumRealtimeChannel = supabaseClient
    .channel('public:forum_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forum' }, () => {
      checkForumUnreadNotifications();
      if (currentTopicId) {
        loadPosts(currentTopicId);
      } else {
        loadTopics();
      }
    })
    .subscribe();
}

async function loadForum() {
  await pobierzUzytkownikowForum();
  const savedTopicId = localStorage.getItem("forum_active_topic_id");
  if (savedTopicId) {
    await openTopicById(parseInt(savedTopicId, 10));
  } else {
    showTopicsList();
  }
}

function showTopicsList() {
  currentTopicId = null;
  localStorage.removeItem("forum_active_topic_id");

  const formBox = document.getElementById("newTopicFormCollapse");
  const icon = document.getElementById("iconNewTopicToggle");
  if (formBox) formBox.style.display = "none";
  if (icon) icon.className = "bi bi-chevron-down text-muted";

  const v1 = document.getElementById("forumTopicsView");
  const v2 = document.getElementById("forumSingleTopicView");
  if (v1 && v2) {
    v1.style.display = "block";
    v2.style.display = "none";
  }
  loadTopics();
  checkForumUnreadNotifications();
}

window.toggleNewTopicForm = function() {
  const formBox = document.getElementById("newTopicFormCollapse");
  const icon = document.getElementById("iconNewTopicToggle");
  if (!formBox) return;

  const isHidden = formBox.style.display === "none";
  formBox.style.display = isHidden ? "block" : "none";
  if (icon) {
    icon.className = isHidden ? "bi bi-chevron-up text-muted" : "bi bi-chevron-down text-muted";
  }
};

window.toggleArchivedTopics = function() {
  const list = document.getElementById("forumArchivedTopicsList");
  const icon = document.getElementById("iconArchivedToggle");
  if (!list) return;
  const isHidden = list.style.display === "none";
  list.style.display = isHidden ? "block" : "none";
  if (icon) icon.className = isHidden ? "bi bi-chevron-up text-muted" : "bi bi-chevron-down text-muted";
};

async function loadTopics() {
  const activeContainer = document.getElementById("forumTopicsList");
  const archivedContainer = document.getElementById("forumArchivedTopicsList");
  if (!activeContainer || !archivedContainer) return;

  activeContainer.innerHTML = "<div class='text-muted small py-2'>Ładowanie wątków...</div>";
  archivedContainer.innerHTML = "<div class='text-muted small py-2'>Ładowanie archiwum...</div>";

  await pobierzUzytkownikowForum();

  const { data: topics, error } = await supabaseClient
    .from("forum_topics")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: false });

  if (error || !topics) {
    activeContainer.innerHTML = `<div class='text-danger small py-2'>Błąd: ${error ? error.message : ''}</div>`;
    return;
  }

  const { data: allPosts } = await supabaseClient.from("forum").select("topic_id, created_at, created_by").eq("deleted", false);
  const { data: mySubs } = await supabaseClient.from("forum_subscriptions").select("topic_id, is_subscribed, last_read_at").eq("user_id", currentUserId);

  const subMap = {};
  if (mySubs) mySubs.forEach(s => subMap[s.topic_id] = s);

  const activeTopics = topics.filter(t => !t.is_archived);
  const archivedTopics = topics.filter(t => t.is_archived);

  if (activeTopics.length === 0) {
    activeContainer.innerHTML = "<div class='text-muted small py-2'>Brak aktywnych wątków. Załóż temat powyżej!</div>";
  } else {
    activeContainer.innerHTML = activeTopics.map(t => renderSingleTopicItem(t, allPosts, subMap[t.id], false)).join("");
  }

  if (archivedTopics.length === 0) {
    archivedContainer.innerHTML = "<div class='text-muted small py-2'>Brak zarchiwizowanych wątków.</div>";
  } else {
    archivedContainer.innerHTML = archivedTopics.map(t => renderSingleTopicItem(t, allPosts, subMap[t.id], true)).join("");
  }
}

function renderSingleTopicItem(t, allPosts, subData, isArchived) {
  const author = forumUsersMap[t.created_by] || "Uczestnik";
  const avatar = renderAvatarHtml(author);
  const topicPosts = allPosts ? allPosts.filter(p => p.topic_id === t.id) : [];
  const count = topicPosts.length;
  
  const dateObj = new Date(t.created_at);
  const date = dateObj.toLocaleString("pl-PL", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });

  const diffSec = (new Date() - dateObj) / 1000;
  const isAuthor = (t.created_by == currentUserId || (currentUser && author.toLowerCase() === currentUser.toLowerCase()));

  let hasUnread = false;
  const isSubscribed = subData ? subData.is_subscribed : false;
  if (isSubscribed && subData.last_read_at && topicPosts.length > 0) {
    const lastRead = new Date(subData.last_read_at).getTime();
    hasUnread = topicPosts.some(p => p.created_by != currentUserId && new Date(p.created_at).getTime() > (lastRead + 1000));
  }

  let actionBtnHtml = "";
  if (isAuthor) {
    if (diffSec <= 60 && !isArchived) {
      actionBtnHtml = `
        <button class="btn btn-sm btn-outline-danger py-0 px-2 mt-1" 
                style="font-size: 11px; white-space: nowrap;" 
                onclick="event.stopPropagation(); deleteTopic(${t.id})">
          🗑️ Usuń (${Math.max(0, Math.round(60 - diffSec))}s)
        </button>
      `;
    } else if (!isArchived) {
      actionBtnHtml = `
        <button class="btn btn-sm btn-outline-secondary py-0 px-2 mt-1" 
                style="font-size: 11px; white-space: nowrap;" 
                onclick="event.stopPropagation(); archiveTopic(${t.id}, true)">
          📦 Archiwizuj
        </button>
      `;
    } else {
      actionBtnHtml = `
        <button class="btn btn-sm btn-outline-success py-0 px-2 mt-1" 
                style="font-size: 11px; white-space: nowrap;" 
                onclick="event.stopPropagation(); archiveTopic(${t.id}, false)">
          🔄 Przywróć
        </button>
      `;
    }
  }

  return `
    <div class="forum-topic-item border-bottom mb-2 p-2 ${isArchived ? 'bg-light opacity-75' : ''}" onclick="openTopicById(${t.id})" style="cursor: pointer;">
      <div class="d-flex justify-content-between align-items-start">
        <div class="pe-2">
          <div class="d-flex align-items-center flex-wrap gap-1">
            ${hasUnread ? '<span class="badge-nowe-watek">NOWE</span>' : ''}
            <div class="fw-bold" style="color: var(--burgund); font-size: 1rem; word-break: break-word;">${t.title}</div>
            ${isSubscribed ? '<i class="bi bi-bell-fill text-warning ms-1" style="font-size: 11px;" title="Obserwujesz ten wątek"></i>' : ''}
          </div>
          <div class="small text-muted mt-2 d-flex align-items-center">
            ${avatar}
            <span><b>${author}</b> &bull; ${date}</span>
          </div>
        </div>
        <div class="d-flex flex-column align-items-end flex-shrink-0 ms-2">
          <span class="badge ${hasUnread ? 'bg-danger' : 'bg-light text-dark border'}">💬 ${count}</span>
          ${actionBtnHtml}
        </div>
      </div>
    </div>
  `;
}

const btnCreateTopic = document.getElementById("btnCreateTopic");
if (btnCreateTopic) {
  btnCreateTopic.onclick = async () => {
    const titleInput = document.getElementById("newTopicTitle");
    const firstPostInput = document.getElementById("newTopicFirstPost");
    const title = titleInput.value.trim();
    const firstPostContent = firstPostInput.innerHTML.trim();

    if (!title || !firstPostContent || firstPostContent === "<br>") {
      alert("Wpisz tytuł i treść pierwszej wiadomości!");
      return;
    }

    btnCreateTopic.disabled = true;

    const { data: topicData, error } = await supabaseClient
      .from("forum_topics")
      .insert({
        title: title,
        created_by: currentUserId,
        is_archived: false,
        deleted: false
      })
      .select().single();

    if (!error && topicData) {
      await supabaseClient.from("forum").insert({
        topic_id: topicData.id,
        comment: firstPostContent,
        created_by: currentUserId,
        deleted: false
      });

      await subscribeMentionedUsers(firstPostContent, topicData.id);

      titleInput.value = "";
      firstPostInput.innerHTML = "";
      btnCreateTopic.disabled = false;
      openTopicById(topicData.id);
    } else {
      btnCreateTopic.disabled = false;
      alert("Błąd podczas tworzenia wątku.");
    }
  };
}

async function openTopicById(topicId) {
  currentTopicId = parseInt(topicId, 10);
  localStorage.setItem("forum_active_topic_id", currentTopicId);

  await pobierzUzytkownikowForum();

  if (currentUserId) {
    await supabaseClient.from("forum_subscriptions").upsert({
      topic_id: currentTopicId,
      user_id: currentUserId,
      is_subscribed: true,
      last_read_at: new Date().toISOString()
    }, { onConflict: 'topic_id, user_id' });
  }

  const { data: topic, error } = await supabaseClient
    .from("forum_topics")
    .select("*")
    .eq("id", currentTopicId)
    .single();

  if (error || !topic || topic.deleted) {
    showTopicsList();
    return;
  }

  currentTopicIsArchived = topic.is_archived;

  document.getElementById("forumTopicsView").style.display = "none";
  document.getElementById("forumSingleTopicView").style.display = "block";

  setupSubscriptionBell(currentTopicId);

  const titleEl = document.getElementById("activeTopicTitle");
  const actionsEl = document.getElementById("topicHeaderActions");
  
  if (titleEl) {
    titleEl.innerText = topic.title;
  }

  if (actionsEl) {
    const diffSec = (new Date() - new Date(topic.created_at)) / 1000;
    const author = forumUsersMap[topic.created_by] || "";
    const isAuthor = (topic.created_by == currentUserId || (currentUser && author.toLowerCase() === currentUser.toLowerCase()));

    let headerAction = "";
    if (isAuthor) {
      if (diffSec <= 60 && !topic.is_archived) {
        headerAction = `<button class="btn btn-sm btn-outline-danger py-0 px-2" style="font-size: 11px;" onclick="deleteTopic(${topic.id})">🗑️ Usuń</button>`;
      } else if (!topic.is_archived) {
        headerAction = `<button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size: 11px;" onclick="archiveTopic(${topic.id}, true)">📦 Archiwizuj</button>`;
      } else {
        headerAction = `<button class="btn btn-sm btn-outline-success py-0 px-2" style="font-size: 11px;" onclick="archiveTopic(${topic.id}, false)">🔄 Przywróć</button>`;
      }
    }
    actionsEl.innerHTML = headerAction;
  }

  const editorCard = document.getElementById("forumPostEditor")?.closest(".card");
  if (editorCard) editorCard.style.display = topic.is_archived ? "none" : "block";

  const editor = document.getElementById("forumPostEditor");
  if (editor) editor.innerHTML = "";

  await loadPosts(currentTopicId);
  checkForumUnreadNotifications();
}

async function setupSubscriptionBell(topicId) {
  const btnBell = document.getElementById("btnToggleSubscription");
  const iconBell = document.getElementById("iconTopicSub");
  if (!btnBell || !iconBell) return;

  const { data: sub } = await supabaseClient
    .from("forum_subscriptions")
    .select("is_subscribed")
    .eq("topic_id", topicId)
    .eq("user_id", currentUserId)
    .maybeSingle();

  let isSubbed = sub ? sub.is_subscribed : true;
  renderBellIcon(isSubbed);

  btnBell.onclick = async () => {
    isSubbed = !isSubbed;
    renderBellIcon(isSubbed);

    await supabaseClient.from("forum_subscriptions").upsert({
      topic_id: topicId,
      user_id: currentUserId,
      is_subscribed: isSubbed,
      last_read_at: new Date().toISOString()
    }, { onConflict: 'topic_id, user_id' });

    checkForumUnreadNotifications();
  };
}

function renderBellIcon(isSubbed) {
  const iconBell = document.getElementById("iconTopicSub");
  if (!iconBell) return;
  if (isSubbed) {
    iconBell.className = "bi bi-bell-fill text-warning fs-6";
    iconBell.parentElement.title = "Powiadomienia włączone";
  } else {
    iconBell.className = "bi bi-bell-slash text-muted fs-6";
    iconBell.parentElement.title = "Powiadomienia wyłączone";
  }
}

async function loadPosts(topicId) {
  const container = document.getElementById("forumPostsList");
  if (!container) return;

  const parsedId = parseInt(topicId, 10);
  container.innerHTML = "<div class='text-muted small py-2'>Ładowanie odpowiedzi...</div>";

  await pobierzUzytkownikowForum();

  const { data: posts, error } = await supabaseClient
    .from("forum")
    .select("id, comment, created_at, created_by")
    .eq("topic_id", parsedId)
    .eq("deleted", false)
    .order("created_at", { ascending: true });

  if (error || !posts || posts.length === 0) {
    container.innerHTML = "<div class='text-muted small py-3 text-center'>Brak odpowiedzi w tym wątku.</div>";
    return;
  }

  const postIds = posts.map(p => p.id);
  const { data: likesData } = await supabaseClient
    .from("forum_likes")
    .select("post_id, user_id")
    .in("post_id", postIds);

  const likesMap = {};
  const myLikedSet = new Set();

  if (likesData) {
    likesData.forEach(l => {
      likesMap[l.post_id] = (likesMap[l.post_id] || 0) + 1;
      if (l.user_id == currentUserId) myLikedSet.add(l.post_id);
    });
  }

  container.innerHTML = posts.map(p => {
    const author = forumUsersMap[p.created_by] || "Uczestnik";
    const avatar = renderAvatarHtml(author);
    const dateObj = new Date(p.created_at);
    const date = dateObj.toLocaleString("pl-PL", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });

    const diffSec = (new Date() - dateObj) / 1000;
    const isAuthor = (p.created_by == currentUserId || (currentUser && author.toLowerCase() === currentUser.toLowerCase()));

    let deleteBtn = "";
    if (isAuthor && diffSec <= 60 && !currentTopicIsArchived) {
      deleteBtn = `<button class="btn btn-sm btn-outline-danger py-0 px-1 ms-2" style="font-size: 10px;" onclick="deletePost(${p.id})">🗑️ (${Math.max(0, Math.round(60 - diffSec))}s)</button>`;
    }

    const likeCount = likesMap[p.id] || 0;
    const isLiked = myLikedSet.has(p.id);
    const formattedComment = parseMentionsInHtml(p.comment);

    return `
      <div class="forum-post-card shadow-sm mb-3 p-3 bg-white rounded-3 border">
        <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
          <div class="d-flex align-items-center">
            ${avatar}
            <b style="color: var(--burgund); font-size: 0.95rem;">${author}</b>
          </div>
          <div class="d-flex align-items-center">
            <span class="text-muted small" style="font-size: 11px;">${date}</span>
            ${deleteBtn}
          </div>
        </div>
        <div class="forum-post-body mb-2" style="font-size: 0.92rem; line-height: 1.5;">
          ${formattedComment}
        </div>
        <div class="d-flex justify-content-end align-items-center pt-1 border-top">
          <button class="btn-forum-like ${isLiked ? 'liked' : ''}" onclick="toggleLike(${p.id})">
            <i class="bi ${isLiked ? 'bi-heart-fill' : 'bi-heart'}"></i>
            <span>${likeCount > 0 ? likeCount : ''}</span>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

window.toggleLike = async function(postId) {
  if (!currentUserId) return;

  const { data: existing } = await supabaseClient
    .from("forum_likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", currentUserId)
    .maybeSingle();

  if (existing) {
    await supabaseClient.from("forum_likes").delete().eq("id", existing.id);
  } else {
    await supabaseClient.from("forum_likes").insert({
      post_id: postId,
      user_id: currentUserId
    });
  }

  if (currentTopicId) loadPosts(currentTopicId);
};

const btnSendPost = document.getElementById("btnSendPost");
if (btnSendPost) {
  btnSendPost.onclick = async () => {
    const editor = document.getElementById("forumPostEditor");
    const content = editor.innerHTML.trim();
    if (!content || content === "<br>" || !currentTopicId) return;

    btnSendPost.disabled = true;
    const { error } = await supabaseClient.from("forum").insert({
      topic_id: parseInt(currentTopicId, 10),
      comment: content,
      created_by: currentUserId,
      deleted: false
    });

    btnSendPost.disabled = false;
    if (!error) {
      await subscribeMentionedUsers(content, currentTopicId);

      await supabaseClient.from("forum_subscriptions").upsert({
        topic_id: parseInt(currentTopicId, 10),
        user_id: currentUserId,
        is_subscribed: true,
        last_read_at: new Date().toISOString()
      }, { onConflict: 'topic_id, user_id' });

      editor.innerHTML = "";
      await loadPosts(currentTopicId);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    } else {
      alert("Błąd publikacji: " + error.message);
    }
  };
}

window.deleteTopic = async function(topicId) {
  if (!confirm("Czy na pewno chcesz usunąć ten wątek?")) return;
  await supabaseClient.from("forum_topics").update({ deleted: true }).eq("id", parseInt(topicId, 10));
  showTopicsList();
};

window.archiveTopic = async function(topicId, archive) {
  const actionText = archive ? "zarchiwizować" : "przywrócić z archiwum";
  if (!confirm(`Czy na pewno chcesz ${actionText} ten wątek?`)) return;

  await supabaseClient.from("forum_topics").update({ is_archived: archive }).eq("id", parseInt(topicId, 10));
  if (currentTopicId) openTopicById(topicId);
  else loadTopics();
};

window.deletePost = async function(postId) {
  if (!confirm("Czy na pewno chcesz usunąć tę wiadomość?")) return;
  await supabaseClient.from("forum").update({ deleted: true }).eq("id", parseInt(postId, 10));
  if (currentTopicId) loadPosts(currentTopicId);
};

// ==============================================================================
// 3. MODUŁ: WYDATKI
// ==============================================================================
async function loadCosts() {
  const container = document.getElementById("costsList");
  if (!container) return;
  container.innerHTML = "";

  const { data } = await supabaseClient
    .from("costs")
    .select("*")
    .eq("deleted", false)
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) {
    container.innerHTML = `<div class="text-center text-muted small p-3">Brak zarejestrowanych wydatków.</div>`;
    return;
  }

  setupBorrowerSelectionUI();

  const grouped = {};
  data.forEach(c => {
    if (c.is_private) {
      const allowedUsers = [c.paid_by, malzenstwaMapa[c.paid_by]];
      if (!allowedUsers.includes(currentUser)) return;
    }

    const dateKey = c.created_at.substring(0, 10);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(c);
  });

  const now = new Date().getTime();

  Object.entries(grouped).forEach(([dateStr, items]) => {
    const header = document.createElement("div");
    header.className = "cost-date-header";
    header.innerText = `📅 ${dateStr}`;
    container.appendChild(header);

    items.forEach(c => {
      const card = document.createElement("div");
      card.className = c.is_private ? "stado-card-private" : "stado-card";

      const diffSec = (now - new Date(c.created_at).getTime()) / 1000;
      const isUnderOneMinute = diffSec <= 60;
      const isAuthor = (c.created_by == currentUserId || (currentUser && c.paid_by && c.paid_by.toLowerCase() === currentUser.toLowerCase()));
      const canDelete = isUnderOneMinute && isAuthor;
      const remainingSec = Math.max(0, Math.round(60 - diffSec));

      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div class="fw-bold">${c.is_private ? '🔒 [Prywatny] ' : ''}${c.cost_name}</div>
          <div class="fw-bold fs-6" style="color:var(--burgund);">${Number(c.amount).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${c.currency}</div>
        </div>
        <div class="small text-muted mt-1">
          Płacił(a): <b>${c.paid_by}</b> ${c.is_private ? '' : `➔ Dla: <b>${c.borrower}</b>`}
        </div>
        ${c.comment ? `<div class="small fst-italic text-secondary mt-1">${c.comment}</div>` : ''}
        ${canDelete ? `
          <div class="text-end mt-2">
            <button class="cost-delete-btn" onclick="window.usunWydatek(${c.id})">🗑️ Usuń (${remainingSec}s)</button>
          </div>
        ` : ''}
      `;
      container.appendChild(card);
    });
  });
}

function setupBorrowerSelectionUI() {
  const usersContainer = document.getElementById("borrowerUsersCheckboxes");
  if (usersContainer && usersContainer.children.length === 0) {
    Object.keys(ekipyMapa).sort().forEach(uName => {
      const label = document.createElement("label");
      label.className = "badge bg-white text-dark border p-1 small";
      label.innerHTML = `<input type="checkbox" class="user-cb" value="${uName}"> ${uName}`;
      usersContainer.appendChild(label);
    });
  }

  const isPrivateCb = document.getElementById("costIsPrivate");
  const wrapper = document.getElementById("costBorrowerWrapper");
  if (isPrivateCb && wrapper) {
    isPrivateCb.onchange = () => {
      wrapper.style.display = isPrivateCb.checked ? "none" : "block";
    };
  }

  const rAll = document.getElementById("bModeAll");
  const rTeams = document.getElementById("bModeTeams");
  const rUsers = document.getElementById("bModeUsers");
  const boxTeams = document.getElementById("boxBorrowerTeams");
  const boxUsers = document.getElementById("boxBorrowerUsers");

  const updateModeVisibility = () => {
    if (boxTeams) boxTeams.style.display = (rTeams && rTeams.checked) ? "block" : "none";
    if (boxUsers) boxUsers.style.display = (rUsers && rUsers.checked) ? "block" : "none";
  };

  [rAll, rTeams, rUsers].forEach(r => {
    if (r) r.onchange = updateModeVisibility;
  });
}

window.usunWydatek = async function(costId) {
  if (!confirm("Czy na pewno chcesz usunąć ten wydatek?")) return;
  await supabaseClient.from("costs").update({ deleted: true }).eq("id", costId);
  loadCosts();
  loadWallet();
};

const formCost = document.getElementById("formCost");
if (formCost) {
  formCost.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("costName").value.trim();
    const amount = parseFloat(document.getElementById("costAmount").value);
    const currency = document.getElementById("costCurrency").value;
    const comment = document.getElementById("costComment").value.trim();
    const isPrivate = document.getElementById("costIsPrivate").checked;

    let borrower = "Całe Stado";
    if (!isPrivate) {
      const mode = document.querySelector("input[name='borrowerMode']:checked").value;
      if (mode === "teams") {
        const selTeams = Array.from(document.querySelectorAll(".team-cb:checked")).map(cb => cb.value);
        if (selTeams.length === 0) {
          alert("Wybierz przynajmniej jedną ekipę!");
          return;
        }
        borrower = selTeams.join(", ");
      } else if (mode === "users") {
        const selUsers = Array.from(document.querySelectorAll(".user-cb:checked")).map(cb => cb.value);
        if (selUsers.length === 0) {
          alert("Wybierz przynajmniej jedną osobę!");
          return;
        }
        borrower = selUsers.join(", ");
      }
    }

    if (!name || isNaN(amount) || amount <= 0) return;

    await supabaseClient.from("costs").insert({
      created_by: currentUserId,
      paid_by: currentUser,
      amount: amount,
      currency: currency,
      cost_name: name,
      borrower: isPrivate ? "Tylko dla mnie" : borrower,
      comment: comment,
      is_private: isPrivate,
      settled_by: []
    });

    formCost.reset();
    document.querySelectorAll(".team-cb, .user-cb").forEach(cb => cb.checked = false);
    document.getElementById("bModeAll").checked = true;
    document.getElementById("boxBorrowerTeams").style.display = "none";
    document.getElementById("boxBorrowerUsers").style.display = "none";
    document.getElementById("costBorrowerWrapper").style.display = "block";

    loadCosts();
    loadWallet();
  };
}

// ==============================================================================
// 4. MODUŁ: ZAKUPY
// ==============================================================================
let currentActiveShoppingListId = null;

async function loadShoppingLists() {
  const select = document.getElementById("shoppingListSelect");
  const btnNew = document.getElementById("btnNewShoppingList");
  if (!select) return;
  select.innerHTML = "";

  await populateShoppingSuggestions();

  const { data } = await supabaseClient
    .from("shoppinglists")
    .select("*")
    .order("id", { ascending: true });

  if (data && data.length > 0) {
    const hasUnclosed = data.some(l => !l.closed);
    if (btnNew) btnNew.style.display = hasUnclosed ? "none" : "block";

    const reversed = [...data].reverse();
    reversed.forEach((l) => {
      const seqIndex = data.indexOf(l) + 1;
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.setAttribute("data-seq", seqIndex);
      const dataStr = l.created_at.substring(0, 10);
      opt.innerText = `Lista #${seqIndex} - ${dataStr} ${l.closed ? '(Zamknięta)' : '🟢 W toku'}`;
      select.appendChild(opt);
    });

    select.onchange = () => switchShoppingList(select.value);
    switchShoppingList(reversed[0].id);
  } else {
    if (btnNew) btnNew.style.display = "block";
    const { data: newList } = await supabaseClient.from("shoppinglists").insert({ created_by: currentUserId, closed: false }).select().single();
    if (newList) loadShoppingLists();
  }
}

async function populateShoppingSuggestions() {
  const datalist = document.getElementById("productSuggestions");
  if (!datalist) return;
  datalist.innerHTML = "";

  const { data } = await supabaseClient.from("shoppingitems").select("product_name");
  if (data) {
    const unikalne = [...new Set(data.map(i => i.product_name))].sort();
    unikalne.forEach(prod => {
      const opt = document.createElement("option");
      opt.value = prod;
      datalist.appendChild(opt);
    });
  }
}

async function switchShoppingList(listId) {
  currentActiveShoppingListId = listId;
  const { data: listData } = await supabaseClient.from("shoppinglists").select("*").eq("id", listId).single();
  const isClosed = listData ? listData.closed : false;

  const controls = document.getElementById("activeListControls");
  const closedBadge = document.getElementById("closedListBadge");

  if (controls && closedBadge) {
    controls.style.display = isClosed ? "none" : "block";
    closedBadge.style.display = isClosed ? "block" : "none";
  }

  loadShoppingItems(listId, isClosed);
}

async function loadShoppingItems(listId, isClosed) {
  const container = document.getElementById("shoppingItemsList");
  if (!container) return;
  container.innerHTML = "";

  const { data } = await supabaseClient
    .from("shoppingitems")
    .select("*")
    .eq("list_id", listId)
    .order("id");

  if (data && data.length > 0) {
    let unboughtCount = 0;

    data.forEach(it => {
      if (!it.bought) unboughtCount++;
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center py-2";
      li.innerHTML = `
        <span class="${it.bought ? 'shopping-item-bought' : 'fw-bold'}">${it.product_name}</span>
        <div class="d-flex align-items-center gap-2">
          <input type="checkbox" class="form-check-input" ${it.bought ? 'checked' : ''} ${isClosed ? 'disabled' : ''}>
          ${!isClosed ? `<button class="btn btn-sm btn-outline-danger py-0 px-2" style="font-size: 11px;" onclick="window.usunProduktZListy(${it.id})">✕</button>` : ''}
        </div>
      `;

      const check = li.querySelector("input");
      if (!isClosed) {
        check.onchange = async (e) => {
          const isNowBought = e.target.checked;
          await supabaseClient.from("shoppingitems").update({ bought: isNowBought }).eq("id", it.id);
          
          if (isNowBought && unboughtCount === 1) {
            otworzModalZakonczenia();
          } else {
            loadShoppingItems(listId, isClosed);
          }
        };
      }

      container.appendChild(li);
    });
  } else {
    container.innerHTML = `<li class="list-group-item text-center text-muted small py-3">Lista jest pusta. Wpisz produkt powyżej.</li>`;
  }
}

window.usunProduktZListy = async function(itemId) {
  await supabaseClient.from("shoppingitems").delete().eq("id", itemId);
  loadShoppingItems(currentActiveShoppingListId, false);
};

const btnNewList = document.getElementById("btnNewShoppingList");
if (btnNewList) {
  btnNewList.onclick = async () => {
    await supabaseClient.from("shoppinglists").insert({ created_by: currentUserId, closed: false });
    loadShoppingLists();
  };
}

async function handleAddProduct() {
  const input = document.getElementById("newProductInput");
  if (!input || !input.value.trim() || !currentActiveShoppingListId) return;

  await supabaseClient.from("shoppingitems").insert({
    list_id: currentActiveShoppingListId,
    product_name: input.value.trim(),
    bought: false
  });
  input.value = "";
  input.focus();
  loadShoppingItems(currentActiveShoppingListId, false);
  populateShoppingSuggestions();
}

const btnAddProd = document.getElementById("btnAddProduct");
if (btnAddProd) {
  btnAddProd.onclick = handleAddProduct;
}

const prodInput = document.getElementById("newProductInput");
if (prodInput) {
  prodInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddProduct();
    }
  });
}

function otworzModalZakonczenia() {
  const modalEl = document.getElementById("modalFinishShopping");
  if (modalEl) {
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  }
}

const btnFinishManual = document.getElementById("btnFinishShoppingManual");
if (btnFinishManual) {
  btnFinishManual.onclick = otworzModalZakonczenia;
}

const formFinish = document.getElementById("formFinishShopping");
if (formFinish) {
  formFinish.onsubmit = async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("finishAmount").value);
    const currency = document.getElementById("finishCurrency").value;
    const borrower = document.getElementById("finishBorrower").value;
    const comment = document.getElementById("finishComment").value.trim();

    if (isNaN(amount) || amount <= 0 || !currentActiveShoppingListId) return;

    await supabaseClient.from("shoppinglists").update({ closed: true }).eq("id", currentActiveShoppingListId);

    const select = document.getElementById("shoppingListSelect");
    const seqNum = select.options[select.selectedIndex].getAttribute("data-seq") || "1";
    const dataStr = new Date().toISOString().substring(0, 10);
    const isOnlyForMyTeam = (borrower === currentTeam);

    await supabaseClient.from("costs").insert({
      created_by: currentUserId,
      paid_by: currentUser,
      amount: amount,
      currency: currency,
      cost_name: `Zakupy: Lista #${seqNum} - ${dataStr}`,
      borrower: isOnlyForMyTeam ? "Tylko dla mnie" : borrower,
      comment: comment,
      is_private: isOnlyForMyTeam,
      settled_by: []
    });

    const modalEl = document.getElementById("modalFinishShopping");
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    loadShoppingLists();
    loadCosts();
    loadWallet();
  };
}

// ==============================================================================
// 5. MODUŁ: KANTOR
// ==============================================================================
window.setKantorAmount = function(val) {
  const input = document.getElementById("exAmount");
  if (input) {
    input.value = val;
    przeliczKantor();
  }
};

function przeliczKantor() {
  const amt = parseFloat(document.getElementById("exAmount").value) || 0;
  const from = document.getElementById("exFrom").value;
  const to = document.getElementById("exTo").value;
  const customToggle = document.getElementById("exCustomToggle");
  const isCustom = customToggle ? customToggle.checked : false;
  const customRateInput = document.getElementById("exCustomRateInput");
  
  let rate = bazaKursow[`${from}_${to}`] || 1.0;
  let rateLabelPrefix = "Kurs rynkowy (EBC)";

  if (from === to) {
    rate = 1.0;
  } else if (isCustom) {
    const customVal = parseFloat(customRateInput.value);
    if (!isNaN(customVal) && customVal > 0) {
      rate = customVal;
      rateLabelPrefix = "Własny kurs";
    }
  }

  const res = amt * rate;
  const formattedRes = to === "HUF" 
    ? Math.round(res).toLocaleString('pl-PL') 
    : res.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const exResult = document.getElementById("exResult");
  if (exResult) {
    exResult.innerHTML = `
      <div class="small text-muted mb-1">${rateLabelPrefix}: 1 ${from} = ${rate.toFixed(4)} ${to}</div>
      <div class="fs-4 fw-bold" style="color:var(--burgund);">${formattedRes} ${to}</div>
    `;
  }

  renderCheatsheet(from, to, rate);
}

function renderCheatsheet(from, to, rate) {
  const tbody = document.getElementById("cheatsheetBody");
  const rateInfo = document.getElementById("cheatsheetRateInfo");
  if (!tbody) return;

  if (rateInfo) {
    rateInfo.innerText = `1 ${from} = ${rate.toFixed(4)} ${to}`;
  }

  let sampleAmounts = [];
  if (from === "HUF") sampleAmounts = [1000, 2000, 5000, 10000, 20000];
  else if (from === "PLN") sampleAmounts = [10, 20, 50, 100, 200];
  else if (from === "EUR") sampleAmounts = [5, 10, 20, 50, 100];
  else sampleAmounts = [1, 5, 10, 50, 100];

  tbody.innerHTML = sampleAmounts.map(amount => {
    const converted = amount * rate;
    const formattedFrom = amount.toLocaleString('pl-PL');
    const formattedTo = to === "HUF" 
      ? Math.round(converted).toLocaleString('pl-PL') 
      : converted.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `
      <tr class="border-bottom">
        <td class="fw-bold py-2" style="color: var(--burgund); width: 50%;">
          ${formattedFrom} ${from}
        </td>
        <td class="text-end fw-bold py-2" style="width: 50%;">
          = ${formattedTo} ${to}
        </td>
      </tr>
    `;
  }).join("");
}

// ==============================================================================
// 6. MODUŁ: PORTFEL
// ==============================================================================
async function loadWallet() {
  const { data: listaW } = await supabaseClient
    .from("costs")
    .select("*")
    .eq("deleted", false)
    .eq("is_private", false);

  const oweContainer = document.getElementById("walletOweList");
  const dueContainer = document.getElementById("walletDueList");
  const summaryEl = document.getElementById("walletTotalSummary");

  if (!oweContainer || !dueContainer || !summaryEl) return;

  oweContainer.innerHTML = "";
  dueContainer.innerHTML = "";

  let razemHuf = 0.0;
  const mamyOddac = [];
  const ktosZalega = [];
  const ALL_TEAMS = ["Bobry", "Pakuły", "Robaki", "Sileziny"];

  if (listaW) {
    listaW.forEach(w => {
      const kwota = parseFloat(w.amount);
      const wal = w.currency;
      const ktoPlacil = w.paid_by;
      const teamPlacacy = ekipyMapa[ktoPlacil] || ktoPlacil;
      const dlaKogoStr = (w.borrower || "Całe Stado").trim();
      const settledArray = Array.isArray(w.settled_by) ? w.settled_by : [];
      const kursDoHuf = bazaKursow[`${wal}_HUF`] || (wal === "HUF" ? 1.0 : (wal === "PLN" ? 85.2 : 368.0));

      if (dlaKogoStr === "Całe Stado") {
        const kwotaUlamka = kwota / 4.0;
        const wartoscHuf = kwotaUlamka * kursDoHuf;

        if (teamPlacacy !== currentTeam) {
          const czyRozliczone = settledArray.includes(currentTeam);
          if (!czyRozliczone) razemHuf -= wartoscHuf;

          mamyOddac.push(`
            <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
              <div>
                <span class="wallet-badge-fraction">1/4</span> Dla: <b>${ktoPlacil} (${teamPlacacy})</b> za <i>${w.cost_name}</i>:
                <b class="${czyRozliczone ? 'text-decoration-line-through text-muted' : 'text-danger'} d-block">${kwotaUlamka.toFixed(2)} ${wal}</b>
              </div>
              <button class="btn btn-sm ${czyRozliczone ? 'btn-settled-yes' : 'btn-settled-no'}" onclick="window.oznaczRozliczenie(${w.id}, '${currentTeam}', ${!czyRozliczone})">
                ${czyRozliczone ? '✓ Rozliczono' : '✕ Do rozliczenia'}
              </button>
            </div>
          `);
        } else {
          ALL_TEAMS.forEach(ekipa => {
            if (ekipa === currentTeam) return;
            const czyRozliczone = settledArray.includes(ekipa);
            if (!czyRozliczone) razemHuf += wartoscHuf;

            ktosZalega.push(`
              <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                  <span class="wallet-badge-fraction">1/4</span> <b>${ekipa}</b> za <i>${w.cost_name}</i>:
                  <b class="${czyRozliczone ? 'text-decoration-line-through text-muted' : 'text-success'} d-block">${kwotaUlamka.toFixed(2)} ${wal}</b>
                </div>
                <button class="btn btn-sm ${czyRozliczone ? 'btn-settled-yes' : 'btn-settled-no'}" onclick="window.oznaczRozliczenie(${w.id}, '${ekipa}', ${!czyRozliczone})">
                  ${czyRozliczone ? '✓ Rozliczono' : '✕ Do rozliczenia'}
                </button>
              </div>
            `);
          });
        }
      } else {
        const targets = dlaKogoStr.split(",").map(s => s.trim());
        const liczbaStron = targets.length + 1;
        const kwotaUlamka = kwota / liczbaStron;
        const fractionLabel = `1/${liczbaStron}`;
        const wartoscHuf = kwotaUlamka * kursDoHuf;

        targets.forEach(target => {
          const teamTargetu = ekipyMapa[target] || target;
          const czyToMyJestesmyDluznikiem = (target === currentUser || teamTargetu === currentTeam);
          const czyToMyPlacilismy = (teamPlacacy === currentTeam || ktoPlacil === currentUser);
          const relacjaId = target;
          const czyRozliczone = settledArray.includes(relacjaId) || settledArray.includes(teamTargetu) || settledArray.includes(target);

          if (czyToMyJestesmyDluznikiem && !czyToMyPlacilismy) {
            if (!czyRozliczone) razemHuf -= wartoscHuf;

            mamyOddac.push(`
              <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                  <span class="wallet-badge-fraction">${fractionLabel}</span> Dla: <b>${ktoPlacil} (${teamPlacacy})</b> za <i>${w.cost_name}</i>:
                  <b class="${czyRozliczone ? 'text-decoration-line-through text-muted' : 'text-danger'} d-block">${kwotaUlamka.toFixed(2)} ${wal}</b>
                </div>
                <button class="btn btn-sm ${czyRozliczone ? 'btn-settled-yes' : 'btn-settled-no'}" onclick="window.oznaczRozliczenie(${w.id}, '${relacjaId}', ${!czyRozliczone})">
                  ${czyRozliczone ? '✓ Rozliczono' : '✕ Do rozliczenia'}
                </button>
              </div>
            `);
          } else if (czyToMyPlacilismy && !czyToMyJestesmyDluznikiem) {
            if (!czyRozliczone) razemHuf += wartoscHuf;

            ktosZalega.push(`
              <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                  <span class="wallet-badge-fraction">${fractionLabel}</span> <b>${target}</b> za <i>${w.cost_name}</i>:
                  <b class="${czyRozliczone ? 'text-decoration-line-through text-muted' : 'text-success'} d-block">${kwotaUlamka.toFixed(2)} ${wal}</b>
                </div>
                <button class="btn btn-sm ${czyRozliczone ? 'btn-settled-yes' : 'btn-settled-no'}" onclick="window.oznaczRozliczenie(${w.id}, '${relacjaId}', ${!czyRozliczone})">
                  ${czyRozliczone ? '✓ Rozliczono' : '✕ Do rozliczenia'}
                </button>
              </div>
            `);
          }
        });
      }
    });
  }

  oweContainer.innerHTML = mamyOddac.length ? mamyOddac.join("") : "<div class='text-muted small'>Czysto! Brak zaległości.</div>";
  dueContainer.innerHTML = ktosZalega.length ? ktosZalega.join("") : "<div class='text-muted small'>Brak zaległości ze strony innych.</div>";

  summaryEl.innerText = `${razemHuf >= 0 ? '+ ' : '- '}${Math.round(Math.abs(razemHuf)).toLocaleString('pl-PL')} HUF`;
  summaryEl.style.color = razemHuf >= 0 ? "green" : "red";
}

window.oznaczRozliczenie = async function(costId, entityKey, markAsSettled) {
  const { data } = await supabaseClient.from("costs").select("settled_by").eq("id", costId).single();
  let currentSettled = (data && Array.isArray(data.settled_by)) ? [...data.settled_by] : [];

  if (markAsSettled) {
    if (!currentSettled.includes(entityKey)) currentSettled.push(entityKey);
  } else {
    currentSettled = currentSettled.filter(x => x !== entityKey);
  }

  await supabaseClient.from("costs").update({ settled_by: currentSettled }).eq("id", costId);
  loadWallet();
};

// ==============================================================================
// 7. MODUŁ: RAZEM ZA BILETY
// ==============================================================================
function przeliczBilety() {
  const normInput = document.getElementById("calcNormal");
  const ulgInput = document.getElementById("calcReduced");
  const walInput = document.getElementById("calcCurrency");
  const out = document.getElementById("calcResults");

  if (!normInput || !ulgInput || !walInput || !out) return;

  const cNorm = parseFloat(normInput.value) || 0;
  const cUlg = parseFloat(ulgInput.value) || 0;
  const wal = walInput.value;

  let total, bKoszt, pKoszt, rKoszt, sKoszt;
  if (cUlg === 0) {
    total = 15 * cNorm;
    bKoszt = 3 * cNorm;
    pKoszt = rKoszt = sKoszt = 4 * cNorm;
  } else {
    total = 8 * cNorm + 7 * cUlg;
    bKoszt = 2 * cNorm + 1 * cUlg;
    pKoszt = rKoszt = sKoszt = 2 * cNorm + 2 * cUlg;
  }

  out.innerHTML = `
    <h5 class="fw-bold" style="color:var(--burgund);">Razem: ${total.toFixed(2)} ${wal}</h5>
    <ul class="list-unstyled small mb-0 mt-2">
      <li>🐗 <b>Bobry (3 os.):</b> ${bKoszt.toFixed(2)} ${wal}</li>
      <li>🐱 <b>Pakuły (4 os.):</b> ${pKoszt.toFixed(2)} ${wal}</li>
      <li>🐛 <b>Robaki (4 os.):</b> ${rKoszt.toFixed(2)} ${wal}</li>
      <li>🐿️ <b>Sileziny (4 os.):</b> ${sKoszt.toFixed(2)} ${wal}</li>
    </ul>
  `;
}

// ==============================================================================
// 8. MODUŁ: ROZGRYWKI
// ==============================================================================
let activeGameId = null;
let activeGamePlayers = [];
let activeGameLowScoreWins = false;
let currentRoundNumber = 1;

async function loadGames() {
  setupGameCreationUI();
  checkActiveGame();
  loadPastGames();
}

function setupGameCreationUI() {
  const container = document.getElementById("gamePlayersCheckboxes");
  if (container && container.children.length === 0) {
    Object.keys(ekipyMapa).sort().forEach(uName => {
      const label = document.createElement("label");
      label.className = "badge bg-white text-dark border p-2 small";
      label.innerHTML = `<input type="checkbox" class="game-player-cb" value="${uName}"> ${uName}`;
      container.appendChild(label);
    });
  }

  const selType = document.getElementById("gameTypeSelect");
  const customBox = document.getElementById("customGameContainer");
  const lowScoreSwitch = document.getElementById("customLowScoreWins");
  const scoreRuleLabel = document.getElementById("labelScoreRule");

  if (selType && customBox) {
    selType.onchange = () => {
      customBox.style.display = selType.value === "Inna" ? "block" : "none";
    };
  }

  if (lowScoreSwitch && scoreRuleLabel) {
    lowScoreSwitch.onchange = () => {
      scoreRuleLabel.innerText = lowScoreSwitch.checked ? "📉 Wygrywa: NAJMNIEJ pkt" : "📈 Wygrywa: NAJWIĘCEJ pkt";
    };
  }
}

async function checkActiveGame() {
  const { data } = await supabaseClient
    .from("games")
    .select("*")
    .eq("finished", false)
    .order("created_at", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const game = data[0];
    activeGameId = game.id;
    activeGameLowScoreWins = game.low_score_wins;
    
    document.getElementById("gameSetupCard").style.display = "none";
    document.getElementById("gamePodiumCard").style.display = "none";
    document.getElementById("activeGameArea").style.display = "block";

    document.getElementById("activeGameTitle").innerText = game.game_name;
    document.getElementById("activeGameRuleText").innerText = game.low_score_wins ? "📉 Wygrywa najmniej pkt" : "📈 Wygrywa najwięcej pkt";

    await renderActiveGameRounds();
  } else {
    document.getElementById("gameSetupCard").style.display = "block";
    document.getElementById("activeGameArea").style.display = "none";
  }
}

const btnStartGame = document.getElementById("btnStartGame");
if (btnStartGame) {
  btnStartGame.onclick = async () => {
    const selectedCbs = Array.from(document.querySelectorAll(".game-player-cb:checked"));
    const warning = document.getElementById("playersCountWarning");

    if (selectedCbs.length < 2) {
      if (warning) warning.style.display = "block";
      return;
    }
    if (warning) warning.style.display = "none";

    const selType = document.getElementById("gameTypeSelect").value;
    let gameName = selType;
    let lowScoreWins = false;

    if (selType === "Blokus") lowScoreWins = true;
    else if (selType === "1000" || selType === "Remik" || selType === "Carcassonne") lowScoreWins = false;
    else if (selType === "Inna") {
      const customName = document.getElementById("customGameNameInput").value.trim();
      gameName = customName || "Własna Gra";
      const customLowCb = document.getElementById("customLowScoreWins");
      lowScoreWins = customLowCb ? customLowCb.checked : false;
    }

    const { data: newGame } = await supabaseClient.from("games").insert({
      game_name: gameName,
      finished: false,
      low_score_wins: lowScoreWins,
      created_by: currentUserId
    }).select().single();

    if (newGame) {
      activeGameId = newGame.id;
      activeGamePlayers = selectedCbs.map(cb => cb.value);
      activeGameLowScoreWins = lowScoreWins;
      currentRoundNumber = 1;

      for (const p of activeGamePlayers) {
        await supabaseClient.from("gamescores").insert({
          game_id: activeGameId,
          player_name: p,
          round_number: 1,
          points: 0
        });
      }

      checkActiveGame();
    }
  };
}

async function renderActiveGameRounds() {
  const { data: scores } = await supabaseClient
    .from("gamescores")
    .select("*")
    .eq("game_id", activeGameId)
    .order("round_number", { ascending: true });

  if (!scores || scores.length === 0) return;

  activeGamePlayers = [...new Set(scores.map(s => s.player_name))];
  const maxRound = Math.max(...scores.map(s => s.round_number));
  currentRoundNumber = maxRound;

  const compContainer = document.getElementById("completedRoundsList");
  if (compContainer) {
    compContainer.innerHTML = "";

    for (let r = 1; r < maxRound; r++) {
      const roundScores = scores.filter(s => s.round_number === r);
      const scoreStr = roundScores.map(s => `<b>${s.player_name}:</b> ${s.points} pkt`).join(" | ");
      
      const row = document.createElement("div");
      row.className = "round-collapsed-card d-flex justify-content-between align-items-center";
      row.innerHTML = `<span><b>Runda ${r}:</b> ${scoreStr}</span> <span class="badge bg-secondary">Zakończona</span>`;
      compContainer.appendChild(row);
    }
  }

  const roundTitle = document.getElementById("currentRoundTitle");
  if (roundTitle) roundTitle.innerText = `Runda ${maxRound}`;

  const currentInputs = document.getElementById("currentRoundInputs");
  if (currentInputs) {
    currentInputs.innerHTML = "";

    const currRoundScores = scores.filter(s => s.round_number === maxRound);

    activeGamePlayers.forEach(pName => {
      const pScore = currRoundScores.find(s => s.player_name === pName);
      const val = pScore ? pScore.points : 0;

      const col = document.createElement("div");
      col.className = "col-6";
      col.innerHTML = `
        <label class="small fw-bold text-muted">${pName}:</label>
        <input type="number" 
               class="form-control form-control-sm round-score-input" 
               data-player="${pName}" 
               value="${val}" 
               onfocus="if(this.value==='0') this.value='';" 
               onblur="if(this.value==='') this.value='0';">
      `;
      currentInputs.appendChild(col);
    });
  }
}

const btnNextRound = document.getElementById("btnNextRound");
if (btnNextRound) {
  btnNextRound.onclick = async () => {
    const inputs = document.querySelectorAll(".round-score-input");
    
    for (const inp of inputs) {
      const pName = inp.getAttribute("data-player");
      const pts = parseInt(inp.value, 10) || 0;
      await supabaseClient.from("gamescores").update({ points: pts })
        .eq("game_id", activeGameId)
        .eq("round_number", currentRoundNumber)
        .eq("player_name", pName);
    }

    const nextRound = currentRoundNumber + 1;
    for (const p of activeGamePlayers) {
      await supabaseClient.from("gamescores").insert({
        game_id: activeGameId,
        player_name: p,
        round_number: nextRound,
        points: 0
      });
    }

    renderActiveGameRounds();
  };
}

const btnFinishGame = document.getElementById("btnFinishGame");
if (btnFinishGame) {
  btnFinishGame.onclick = async () => {
    if (!confirm("Czy na pewno chcesz zakończyć tę rozgrywkę i podsumować wyniki?")) return;

    const inputs = document.querySelectorAll(".round-score-input");
    for (const inp of inputs) {
      const pName = inp.getAttribute("data-player");
      const pts = parseInt(inp.value, 10) || 0;
      await supabaseClient.from("gamescores").update({ points: pts })
        .eq("game_id", activeGameId)
        .eq("round_number", currentRoundNumber)
        .eq("player_name", pName);
    }

    await supabaseClient.from("games").update({ finished: true }).eq("id", activeGameId);
    showPodium(activeGameId);
  };
}

async function showPodium(gameId) {
  const { data: game } = await supabaseClient.from("games").select("*").eq("id", gameId).single();
  const { data: scores } = await supabaseClient.from("gamescores").select("*").eq("game_id", gameId);

  if (!scores || !game) return;

  const totals = {};
  scores.forEach(s => {
    totals[s.player_name] = (totals[s.player_name] || 0) + s.points;
  });

  const sorted = Object.entries(totals).sort((a, b) => {
    return game.low_score_wins ? a[1] - b[1] : b[1] - a[1];
  });

  const podiumList = document.getElementById("podiumList");
  if (podiumList) {
    podiumList.innerHTML = "";

    sorted.forEach(([pName, totalPts], index) => {
      let medal = `${index + 1}.`;
      let rowClass = "podium-other";

      if (index === 0) { medal = "🥇 1. miejsce"; rowClass = "podium-1"; }
      else if (index === 1) { medal = "🥈 2. miejsce"; rowClass = "podium-2"; }
      else if (index === 2) { medal = "🥉 3. miejsce"; rowClass = "podium-3"; }

      const div = document.createElement("div");
      div.className = `podium-row ${rowClass}`;
      div.innerHTML = `<span><b>${medal}</b> ${pName}</span> <span class="badge bg-dark fs-6">${totalPts} pkt</span>`;
      podiumList.appendChild(div);
    });
  }

  document.getElementById("activeGameArea").style.display = "none";
  document.getElementById("gameSetupCard").style.display = "none";
  document.getElementById("gamePodiumCard").style.display = "block";
  loadPastGames();
}

const btnNewGameReset = document.getElementById("btnNewGameReset");
if (btnNewGameReset) {
  btnNewGameReset.onclick = () => {
    activeGameId = null;
    document.getElementById("gamePodiumCard").style.display = "none";
    document.getElementById("gameSetupCard").style.display = "block";
    document.querySelectorAll(".game-player-cb").forEach(cb => cb.checked = false);
    const customLow = document.getElementById("customLowScoreWins");
    if (customLow) customLow.checked = false;
    const ruleLabel = document.getElementById("labelScoreRule");
    if (ruleLabel) ruleLabel.innerText = "📈 Wygrywa: NAJWIĘCEJ pkt";
  };
}

async function loadPastGames() {
  const container = document.getElementById("pastGamesList");
  if (!container) return;
  container.innerHTML = "";

  const { data: pastGames } = await supabaseClient
    .from("games")
    .select("*")
    .eq("finished", true)
    .order("created_at", { ascending: false })
    .limit(10);

  if (pastGames && pastGames.length > 0) {
    pastGames.forEach(g => {
      const d = g.created_at.substring(0, 10);
      const item = document.createElement("div");
      item.className = "d-flex justify-content-between align-items-center py-2 border-bottom";
      item.innerHTML = `
        <div><b>${g.game_name}</b> <small class="text-muted">(${d})</small></div>
        <button class="btn btn-sm btn-outline-secondary py-0" style="font-size:11px;" onclick="showPodium(${g.id})">Zobacz wyniki</button>
      `;
      container.appendChild(item);
    });
  } else {
    container.innerHTML = "<div class='text-muted small'>Brak zakończonych rozgrywek.</div>";
  }
}

// ==============================================================================
// 9. GLOBALNE LISTENERY ZDARZEŃ
// ==============================================================================
function setupEventListeners() {
  ["calcNormal", "calcReduced", "calcCurrency"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", przeliczBilety);
  });

  const customToggle = document.getElementById("exCustomToggle");
  const customRateContainer = document.getElementById("exCustomRateContainer");
  const customRateInput = document.getElementById("exCustomRateInput");
  const customRateLabel = document.getElementById("exCustomRateLabel");

  const updateCustomLabel = () => {
    const fromEl = document.getElementById("exFrom");
    const toEl = document.getElementById("exTo");
    if (!fromEl || !toEl) return;

    const from = fromEl.value;
    const to = toEl.value;
    if (customRateLabel) {
      customRateLabel.innerText = `Własny kurs (1 ${from} = ? ${to}):`;
    }
    if (customToggle && customToggle.checked && customRateInput) {
      const defaultRate = bazaKursow[`${from}_${to}`] || 1.0;
      customRateInput.value = defaultRate.toFixed(4);
    }
    przeliczKantor();
  };

  if (customToggle) {
    customToggle.onchange = () => {
      const isCustom = customToggle.checked;
      if (customRateContainer) customRateContainer.style.display = isCustom ? "block" : "none";
      
      const fromEl = document.getElementById("exFrom");
      const toEl = document.getElementById("exTo");
      if (!fromEl || !toEl) return;

      const from = fromEl.value;
      const to = toEl.value;
      const defaultRate = bazaKursow[`${from}_${to}`] || 1.0;

      if (isCustom && customRateInput && customRateLabel) {
        customRateInput.value = defaultRate.toFixed(4);
        customRateLabel.innerText = `Własny kurs (1 ${from} = ? ${to}):`;
      } else if (customRateInput) {
        customRateInput.value = "";
      }
      
      przeliczKantor();
    };
  }

  const btnSwap = document.getElementById("btnSwapCurrencies");
  if (btnSwap) {
    btnSwap.onclick = () => {
      const elFrom = document.getElementById("exFrom");
      const elTo = document.getElementById("exTo");
      if (!elFrom || !elTo) return;

      const temp = elFrom.value;
      elFrom.value = elTo.value;
      elTo.value = temp;

      updateCustomLabel();
    };
  }

  ["exAmount", "exCustomRateInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", przeliczKantor);
  });

  ["exFrom", "exTo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateCustomLabel);
  });
}