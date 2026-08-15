// js/app.js

// ==============================================================================
// 0. KONFIGURACJA I ZMIENNE GLOBALNE
// ==============================================================================
const SUPABASE_URL = "https://mkysisoznxgssakcegbn.supabase.co";
const SUPABASE_KEY = "sb_publishable_4lljAeNc5dvmsJG2u1-pgQ_zCnATIE1";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const LICZBA_OSOB_W_EKIPIE = { "Całe Stado": 15, "Bobry": 3, "Pakuły": 4, "Robaki": 4, "Sileziny": 4 };
const DOM_LAT = 47.8522;
const DOM_LNG = 20.3297;

let currentUser = null;
let currentUserId = null;
let currentTeam = "Pakuły";
let currentMode = "Na wyjeździe";
let mapInstance = null;
let bazaKursow = {
  "PLN_HUF": 85.20, "HUF_PLN": 0.0117,
  "PLN_EUR": 0.23,  "EUR_PLN": 4.32,
  "EUR_HUF": 368.0, "HUF_EUR": 0.0027,
  "PLN_PLN": 1.0,   "HUF_HUF": 1.0, "EUR_EUR": 1.0
};
let malzenstwaMapa = {};
let ekipyMapa = {};

// ==============================================================================
// 0.1 INICJALIZACJA I OBSŁUGA SESJI
// ==============================================================================
async function initApp() {
  await pobierzKursyWalut();
  await pobierzUzytkownikowIMalzenstwa();
  await checkAuth();
  setupEventListeners();

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

    // Ładowanie awatara na pulpicie
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

  // Data wyjazdu: 19 sierpnia 2026
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
// 1. MODUŁ: MAPA
// ==============================================================================
let domMarker = null;
let tempMarker = null;
let selectedLatLng = null;
let allMapPlaces = [];
let activeCategoryFilter = "termy";
let currentSearchPhrase = "";
const markersMap = {};

function getCategoryPinIcon(category, number) {
  let pinClass = 'pin-inne';
  const cat = (category || '').toLowerCase();
  
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
  
  mapInstance = L.map('mapContainer').setView([DOM_LAT, DOM_LNG], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(mapInstance);

  const homeIcon = L.divIcon({
    className: 'custom-pin-wrapper',
    html: `<div class="custom-pin pin-dom" style="width: 32px; height: 32px; font-size: 15px;">🏠</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });

  domMarker = L.marker([DOM_LAT, DOM_LNG], { icon: homeIcon }).addTo(mapInstance)
    .bindPopup('<b>🏠 Ámbitus ház (Dom)</b><br><small class="text-muted">Sáfrány út 38/a, Egerszalók</small>');

  mapInstance.on('click', (e) => {
    selectedLatLng = e.latlng;
    if (tempMarker) mapInstance.removeLayer(tempMarker);

    const tempIcon = L.divIcon({
      className: 'custom-pin-wrapper',
      html: `<div class="custom-pin" style="background-color: #f59e0b; width: 30px; height: 30px; font-size: 14px;">📍</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -15]
    });

    tempMarker = L.marker(selectedLatLng, { icon: tempIcon }).addTo(mapInstance);
    tempMarker.bindPopup(`
      <div class="text-center p-1" style="min-width: 140px;">
        <div class="fw-bold mb-2" style="font-size: 12px;">Wybrany punkt</div>
        <button id="btnPopupConfirm" class="btn btn-burgund btn-sm w-100 py-1 mb-1" style="font-size: 11px;">➕ Dodaj ten punkt</button>
        <button id="btnPopupCancel" class="btn btn-outline-secondary btn-sm w-100 py-1" style="font-size: 11px;">❌ Anuluj</button>
      </div>
    `).openPopup();

    setTimeout(() => {
      const btnConfirm = document.getElementById("btnPopupConfirm");
      const btnCancel = document.getElementById("btnPopupCancel");
      if (btnConfirm) {
        btnConfirm.onclick = () => {
          tempMarker.closePopup();
          const card = document.getElementById("addPlaceCard");
          card.style.display = "block";
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          document.getElementById("newPlaceName").focus();
        };
      }
      if (btnCancel) btnCancel.onclick = usunTymczasowyPunkt;
    }, 100);
  });

  setupAddPlaceForm();
  setupFilterAndSearch();
  loadMapPlaces();
}

function usunTymczasowyPunkt() {
  if (tempMarker) {
    mapInstance.removeLayer(tempMarker);
    tempMarker = null;
  }
  selectedLatLng = null;
  document.getElementById("addPlaceCard").style.display = "none";
  document.getElementById("formAddPlace").reset();
}

function setupAddPlaceForm() {
  const btnCancel = document.getElementById("btnCancelAddPlace");
  if (btnCancel) btnCancel.onclick = usunTymczasowyPunkt;

  const form = document.getElementById("formAddPlace");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("newPlaceName").value.trim();
      const category = document.getElementById("newPlaceCategory").value || "Inne";
      if (!name || !selectedLatLng) return;

      const { error } = await supabaseClient.from("map").insert({
        name: name,
        category: category,
        lat: selectedLatLng.lat,
        lng: selectedLatLng.lng,
        created_by: currentUserId
      });

      if (error) {
        alert("Błąd zapisu: " + error.message);
        return;
      }

      usunTymczasowyPunkt();
      loadMapPlaces();
    };
  }
}

function setupFilterAndSearch() {
  const searchInput = document.getElementById("placeSearchInput");
  if (searchInput) {
    searchInput.oninput = (e) => {
      currentSearchPhrase = e.target.value.toLowerCase().trim();
      renderPlacesList();
    };
  }

  const pills = document.querySelectorAll(".filter-pill");
  pills.forEach(pill => {
    pill.onclick = () => {
      pills.forEach(p => p.className = "btn btn-sm btn-outline-secondary rounded-pill px-3 filter-pill");
      pill.className = "btn btn-sm btn-burgund rounded-pill px-3 filter-pill active";
      activeCategoryFilter = pill.getAttribute("data-cat");
      renderPlacesList();
    };
  });
}

async function loadMapPlaces() {
  const { data } = await supabaseClient.from("map").select("*").order("id", { ascending: true });
  if (!data) return;

  allMapPlaces = data;
  Object.values(markersMap).forEach(m => mapInstance.removeLayer(m));

  allMapPlaces.forEach((p, index) => {
    if (p.lat && p.lng) {
      const pinNumber = index + 1;
      const icon = getCategoryPinIcon(p.category, pinNumber);
      const marker = L.marker([p.lat, p.lng], { icon: icon }).addTo(mapInstance);

      const popupHtml = `
        <div style="min-width: 170px; max-width: 220px;">
          ${p.photo ? `<img src="${p.photo}" class="map-popup-img" alt="Foto">` : ''}
          <div class="fw-bold" style="color: var(--burgund);">#${pinNumber} ${p.name}</div>
          ${p.distance_from_egerszalok ? `<div class="small text-muted">🚗 ${p.distance_from_egerszalok} km z domu</div>` : ''}
          <button class="btn btn-outline-danger btn-sm w-100 py-1 mt-2" style="font-size: 11px;" onclick="window.pokazSzczegolyMiejsca(${p.id})">
            📄 Pokaż szczegóły
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml);
      markersMap[p.id] = marker;
    }
  });

  renderPlacesList();
}

function renderPlacesList() {
  const list = document.getElementById("placesList");
  if (!list) return;
  list.innerHTML = "";

  const filtered = allMapPlaces.filter((p) => {
    const matchesSearch = !currentSearchPhrase || (p.name && p.name.toLowerCase().includes(currentSearchPhrase)) || (p.address && p.address.toLowerCase().includes(currentSearchPhrase));
    let matchesCategory = true;
    const cat = (p.category || '').toLowerCase();
    if (activeCategoryFilter === 'termy') matchesCategory = cat.includes('term');
    else if (activeCategoryFilter === 'zwiedzanie') matchesCategory = cat.includes('zwiedzanie') || cat.includes('zabytek') || cat.includes('atrakcj');
    else if (activeCategoryFilter === 'jedzenie') matchesCategory = cat.includes('jedzenie') || cat.includes('wino') || cat.includes('restaurac');
    else if (activeCategoryFilter === 'inne') matchesCategory = !cat.includes('term') && !cat.includes('zwiedzanie') && !cat.includes('zabytek') && !cat.includes('jedzenie') && !cat.includes('wino');

    return matchesSearch && matchesCategory;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="p-3 text-center text-muted small">Brak miejsc spełniających kryteria.</div>`;
    return;
  }

  filtered.forEach((p) => {
    const pinNumber = allMapPlaces.indexOf(p) + 1;
    const item = document.createElement("button");
    item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2";
    item.innerHTML = `
      <div class="text-start pe-2">
        <div><b>#${pinNumber}</b> ${p.name}</div>
        <div class="small text-muted">${p.distance_from_egerszalok ? `🚗 ${p.distance_from_egerszalok} km • ` : ''}${p.address || ''}</div>
      </div>
      <span class="badge ${p.category && p.category.toLowerCase().includes('term') ? 'bg-primary' : 'bg-secondary'}">${p.category || 'Atrakcja'}</span>
    `;

    item.onclick = () => {
      document.getElementById("mapContainer").scrollIntoView({ behavior: "smooth", block: "start" });
      mapInstance.setView([p.lat, p.lng], 16);
      if (markersMap[p.id]) markersMap[p.id].openPopup();
    };

    list.appendChild(item);
  });
}

window.pokazSzczegolyMiejsca = function(placeId) {
  const p = allMapPlaces.find(x => x.id === placeId);
  if (!p) return;

  document.getElementById("sheetPlaceTitle").innerText = p.name;
  const body = document.getElementById("sheetPlaceBody");

  let godzinyTekst = "";
  if (p.opening_hours) {
    godzinyTekst = typeof p.opening_hours === 'object' 
      ? Object.entries(p.opening_hours).map(([k, v]) => `<b>${k}:</b> ${v}`).join('<br>')
      : p.opening_hours;
  }

  let cenyTekst = "";
  if (p.prices) {
    cenyTekst = typeof p.prices === 'object' 
      ? Object.entries(p.prices).map(([k, v]) => `<b>${k}:</b> ${v}`).join('<br>')
      : p.prices;
  }

  body.innerHTML = `
    ${p.photo ? `<img src="${p.photo}" class="sheet-header-img" alt="${p.name}">` : ''}
    <div class="mb-3">
      <span class="badge ${p.category && p.category.toLowerCase().includes('term') ? 'bg-primary' : 'bg-secondary'} mb-1">${p.category || 'Atrakcja'}</span>
      ${p.address ? `<div class="small text-muted">📍 ${p.address}</div>` : ''}
      ${p.distance_from_egerszalok ? `<div class="small fw-bold text-dark mt-1">🚗 Odległość z domu: ${p.distance_from_egerszalok} km</div>` : ''}
    </div>
    ${godzinyTekst ? `<div class="sheet-attr-box"><div class="fw-bold text-dark mb-1">🕒 Godziny otwarcia:</div><div>${godzinyTekst}</div></div>` : ''}
    ${cenyTekst ? `<div class="sheet-attr-box"><div class="fw-bold text-dark mb-1">🎟️ Ceny biletów:</div><div>${cenyTekst}</div></div>` : ''}
    <div class="d-grid gap-2 mt-3">
      ${p.official_url ? `<a href="${p.official_url}" target="_blank" class="btn btn-outline-danger btn-sm">🌐 Strona oficjalna</a>` : ''}
      ${p.lat && p.lng ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" class="btn btn-burgund btn-sm">🧭 Nawiguj (Google Maps)</a>` : ''}
    </div>
  `;

  const sheetEl = document.getElementById("placeDetailsSheet");
  const bsSheet = new bootstrap.Offcanvas(sheetEl);
  bsSheet.show();
};

// ==============================================================================
// 2. MODUŁ: FORUM DYSKUSYJNE
// ==============================================================================
let currentTopicId = null;
let currentTopicIsArchived = false;
let forumUsersMap = {};

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
      users.forEach(u => { forumUsersMap[u.id] = u.login; });
    }
  }
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

  const { data: allPosts } = await supabaseClient.from("forum").select("topic_id").eq("deleted", false);

  const activeTopics = topics.filter(t => !t.is_archived);
  const archivedTopics = topics.filter(t => t.is_archived);

  if (activeTopics.length === 0) {
    activeContainer.innerHTML = "<div class='text-muted small py-2'>Brak aktywnych wątków. Załóż temat powyżej!</div>";
  } else {
    activeContainer.innerHTML = activeTopics.map(t => renderSingleTopicItem(t, allPosts, false)).join("");
  }

  if (archivedTopics.length === 0) {
    archivedContainer.innerHTML = "<div class='text-muted small py-2'>Brak zarchiwizowanych wątków.</div>";
  } else {
    archivedContainer.innerHTML = archivedTopics.map(t => renderSingleTopicItem(t, allPosts, true)).join("");
  }
}

function renderSingleTopicItem(t, allPosts, isArchived) {
  const author = forumUsersMap[t.created_by] || "Uczestnik";
  const avatar = renderAvatarHtml(author);
  const count = allPosts ? allPosts.filter(p => p.topic_id === t.id).length : 0;
  const dateObj = new Date(t.created_at);
  const date = dateObj.toLocaleString("pl-PL", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
  
  const diffSec = (new Date() - dateObj) / 1000;
  const isAuthor = (t.created_by == currentUserId || (currentUser && author.toLowerCase() === currentUser.toLowerCase()));

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
          <div class="fw-bold" style="color: var(--burgund); font-size: 1rem; word-break: break-word;">${t.title}</div>
          <div class="small text-muted mt-2 d-flex align-items-center">
            ${avatar}
            <span><b>${author}</b> &bull; ${date}</span>
          </div>
        </div>
        <div class="d-flex flex-column align-items-end flex-shrink-0 ms-2">
          <span class="badge bg-light text-dark border">💬 ${count}</span>
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

  const titleEl = document.getElementById("activeTopicTitle");
  if (titleEl) {
    const diffSec = (new Date() - new Date(topic.created_at)) / 1000;
    const author = forumUsersMap[topic.created_by] || "";
    const isAuthor = (topic.created_by == currentUserId || (currentUser && author.toLowerCase() === currentUser.toLowerCase()));

    let headerAction = "";
    if (isAuthor) {
      if (diffSec <= 60 && !topic.is_archived) {
        headerAction = `<button class="btn btn-sm btn-outline-danger py-0 px-2 ms-2" style="font-size: 11px;" onclick="deleteTopic(${topic.id})">🗑️ Usuń wątek</button>`;
      } else if (!topic.is_archived) {
        headerAction = `<button class="btn btn-sm btn-outline-secondary py-0 px-2 ms-2" style="font-size: 11px;" onclick="archiveTopic(${topic.id}, true)">📦 Archiwizuj wątek</button>`;
      } else {
        headerAction = `<button class="btn btn-sm btn-outline-success py-0 px-2 ms-2" style="font-size: 11px;" onclick="archiveTopic(${topic.id}, false)">🔄 Przywróć wątek</button>`;
      }
    }

    titleEl.innerHTML = `
      <span>${topic.title}</span>
      ${topic.is_archived ? ' <span class="badge bg-secondary ms-1">Archiwum</span>' : ''}
      ${headerAction}
    `;
  }

  const editorCard = document.getElementById("forumPostEditor")?.closest(".card");
  if (editorCard) editorCard.style.display = topic.is_archived ? "none" : "block";

  const editor = document.getElementById("forumPostEditor");
  if (editor) editor.innerHTML = "";

  await loadPosts(currentTopicId);
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
      deleteBtn = `<button class="btn btn-sm btn-outline-danger py-0 px-1 ms-2" style="font-size: 10px;" onclick="deletePost(${p.id})">🗑️ Usuń (${Math.max(0, Math.round(60 - diffSec))}s)</button>`;
    }

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
        <div class="forum-post-body" style="font-size: 0.92rem; line-height: 1.5;">
          ${p.comment}
        </div>
      </div>
    `;
  }).join("");
}

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

  document.getElementById("exResult").innerHTML = `
    <div class="small text-muted mb-1">${rateLabelPrefix}: 1 ${from} = ${rate.toFixed(4)} ${to}</div>
    <div class="fs-4 fw-bold" style="color:var(--burgund);">${formattedRes} ${to}</div>
  `;

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

  if (!oweContainer || !dueContainer) return;

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
  const cNorm = parseFloat(document.getElementById("calcNormal").value) || 0;
  const cUlg = parseFloat(document.getElementById("calcReduced").value) || 0;
  const wal = document.getElementById("calcCurrency").value;
  const out = document.getElementById("calcResults");

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
  compContainer.innerHTML = "";

  for (let r = 1; r < maxRound; r++) {
    const roundScores = scores.filter(s => s.round_number === r);
    const scoreStr = roundScores.map(s => `<b>${s.player_name}:</b> ${s.points} pkt`).join(" | ");
    
    const row = document.createElement("div");
    row.className = "round-collapsed-card d-flex justify-content-between align-items-center";
    row.innerHTML = `<span><b>Runda ${r}:</b> ${scoreStr}</span> <span class="badge bg-secondary">Zakończona</span>`;
    compContainer.appendChild(row);
  }

  document.getElementById("currentRoundTitle").innerText = `Runda ${maxRound}`;
  const currentInputs = document.getElementById("currentRoundInputs");
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
  const btnHome = document.getElementById("btnCenterHome");
  if (btnHome) {
    btnHome.onclick = () => {
      if (mapInstance) {
        document.getElementById("mapContainer").scrollIntoView({ behavior: "smooth", block: "start" });
        mapInstance.setView([DOM_LAT, DOM_LNG], 16);
        if (domMarker) domMarker.openPopup();
      }
    };
  }

  ["calcNormal", "calcReduced", "calcCurrency"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", przeliczBilety);
  });

  const customToggle = document.getElementById("exCustomToggle");
  const customRateContainer = document.getElementById("exCustomRateContainer");
  const customRateInput = document.getElementById("exCustomRateInput");
  const customRateLabel = document.getElementById("exCustomRateLabel");

  const updateCustomLabel = () => {
    const from = document.getElementById("exFrom").value;
    const to = document.getElementById("exTo").value;
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
      
      const from = document.getElementById("exFrom").value;
      const to = document.getElementById("exTo").value;
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