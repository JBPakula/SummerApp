// js/app.js

// ==============================================================================
// 1. KONFIGURACJA I POŁĄCZENIE Z BAZĄ
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
let bazaKursow = {};
let malzenstwaMapa = {};
let ekipyMapa = {};

// ==============================================================================
// 2. INICJALIZACJA I OBSŁUGA SESJI (LOCALSTORAGE & BAZA)
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  await pobierzKursyWalut();
  await pobierzUzytkownikowIMalzenstwa();
  await checkAuth();
  setupEventListeners();
});

async function pobierzKursyWalut() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=PLN,HUF");
    const dane = await res.json();
    const eurPln = dane.rates.PLN;
    const eurHuf = dane.rates.HUF;

    bazaKursow = {
      "PLN_HUF": eurHuf / eurPln, "HUF_PLN": eurPln / eurHuf,
      "PLN_EUR": 1 / eurPln, "EUR_PLN": eurPln,
      "EUR_HUF": eurHuf, "HUF_EUR": 1 / eurHuf,
      "PLN_PLN": 1.0, "HUF_HUF": 1.0, "EUR_EUR": 1.0
    };
  } catch (e) {
    bazaKursow = {
      "PLN_HUF": 85.20, "HUF_PLN": 0.0117, "PLN_EUR": 0.23,
      "EUR_PLN": 4.32, "EUR_HUF": 368.0, "HUF_EUR": 0.0027,
      "PLN_PLN": 1.0, "HUF_HUF": 1.0, "EUR_EUR": 1.0
    };
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
    console.log("Próba logowania dla:", userName.trim());

    const { data, error } = await supabaseClient.rpc("login_user", {
      p_login: userName.trim(),
      p_passcode: password.trim()
    });

    console.log("Odpowiedź z bazy (RPC):", { data, error });

    if (error) {
      console.error("Błąd RPC z Supabase:", error.message, error.details);
      return false;
    }

    if (!data || data.length === 0) {
      console.warn("Brak pasującego rekordu dla podanych danych.");
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
    document.getElementById("userNameDisplay").innerText = currentUser + " 👋";
    document.getElementById("userTeamDisplay").innerText = currentTeam;
    const welcomeEl = document.getElementById("welcomeUserName");
    if (welcomeEl) {
      welcomeEl.innerText = currentUser;
    }

    // Inteligentne ładowanie awatara (obsługa .jpg, .jpeg, .png oraz fallback)
    const avatarEl = document.getElementById("userAvatar");
    const extensions = ["jpg", "jpeg", "png"];
    let extIndex = 0;

    function tryLoadAvatar() {
      if (extIndex < extensions.length) {
        avatarEl.src = `assets/avatars/${currentUser}.${extensions[extIndex]}`;
        extIndex++;
      } else {
        // Fallback: jeśli żaden format nie istnieje
        avatarEl.onerror = null;
        avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser)}&background=8B0000&color=fff&size=128&bold=true`;
      }
    }

    avatarEl.onerror = tryLoadAvatar;
    tryLoadAvatar();

    renderNavigation();
    initMap();
    loadCosts();
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
// 3. NAWIGACJA
// ==============================================================================
const ALL_TABS = [
  "🏠 Pulpit",
  "🗺️ Mapa", 
  "💰 Wydatki", 
  "🏦 Portfel", 
  "🛒 Zakupy", 
  "📊 Płacimy Razem", 
  "💱 Kantor", 
  "🎲 Rozgrywki", 
  "💬 Forum"
];

function renderNavigation() {
  const container = document.getElementById("navButtonsContainer");
  container.innerHTML = "";

  ALL_TABS.forEach(tab => {
    const btn = document.createElement("button");
    btn.className = "btn btn-outline-danger text-start fw-bold mb-1";
    btn.innerText = tab;
    btn.onclick = () => switchTab(tab);
    container.appendChild(btn);
  });
}

function switchTab(tabName) {
  // Ukryj wszystkie sekcje
  document.querySelectorAll(".app-tab").forEach(el => el.style.display = "none");

  // Zamknij sidebar jeśli otwarty
  const offcanvasEl = document.getElementById('sidebarMenu');
  const offcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl);
  if (offcanvas) offcanvas.hide();

  // Dopasowanie i pokazanie wybranej sekcji
  if (tabName === "dashboard" || tabName.includes("Pulpit")) {
    document.getElementById("tab-dashboard").style.display = "block";
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (tabName.includes("Mapa")) {
    document.getElementById("tab-map").style.display = "block";
    if (mapInstance) {
      setTimeout(() => mapInstance.invalidateSize(), 200);
    }
  } else if (tabName.includes("Wydatki")) {
    document.getElementById("tab-costs").style.display = "block";
    loadCosts();
  } else if (tabName.includes("Portfel")) {
    document.getElementById("tab-wallet").style.display = "block";
    loadWallet();
  } else if (tabName.includes("Zakupy")) {
    document.getElementById("tab-shopping").style.display = "block";
    loadShoppingLists();
  } else if (tabName.includes("Płacimy Razem")) {
    document.getElementById("tab-tickets").style.display = "block";
    przeliczBilety();
  } else if (tabName.includes("Kantor")) {
    document.getElementById("tab-exchange").style.display = "block";
    przeliczKantor();
  } else if (tabName.includes("Rozgrywki")) {
    document.getElementById("tab-games").style.display = "block";
  } else if (tabName.includes("Forum")) {
    document.getElementById("tab-forum").style.display = "block";
    loadForum();
  }
}

// ==============================================================================
// 4. MODUŁ: MAPA
// ==============================================================================
function initMap() {
  if (mapInstance) return;
  mapInstance = L.map('mapContainer').setView([DOM_LAT, DOM_LNG], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(mapInstance);

  L.marker([DOM_LAT, DOM_LNG]).addTo(mapInstance)
    .bindPopup('<b>🏠 Ámbitus ház</b><br>Sáfrány út 38/a, Egerszalók')
    .openPopup();

  loadMapPlaces();
}

async function loadMapPlaces() {
  const { data } = await supabaseClient.from("map").select("*");
  const list = document.getElementById("placesList");
  list.innerHTML = "";

  if (data) {
    data.forEach(p => {
      if (p.lat && p.lng) {
        L.marker([p.lat, p.lng]).addTo(mapInstance).bindPopup(`<b>#${p.id} ${p.name}</b><br>${p.address || ''}`);
        
        const item = document.createElement("button");
        item.className = "list-group-item list-group-item-action small";
        item.innerText = `🌐 #${p.id} - ${p.name} (${p.category})`;
        item.onclick = () => { mapInstance.setView([p.lat, p.lng], 15); };
        list.appendChild(item);
      }
    });
  }
}

// ==============================================================================
// 5. MODUŁ: WYDATKI
// ==============================================================================
async function loadCosts() {
  const { data } = await supabaseClient.from("costs").select("*").eq("deleted", false).order("created_at", { ascending: false });
  const container = document.getElementById("costsList");
  container.innerHTML = "";

  if (data) {
    data.forEach(c => {
      if (c.is_private) {
        const allowedUsers = [c.paid_by, malzenstwaMapa[c.paid_by]];
        if (!allowedUsers.includes(currentUser)) return;
      }

      const card = document.createElement("div");
      card.className = c.is_private ? "stado-card-private" : "stado-card";
      card.innerHTML = `
        <div class="fw-bold">${c.is_private ? '🔒 [Prywatne] ' : ''}${c.cost_name}</div>
        <div class="small text-muted">Płacił(a): <b>${c.paid_by}</b> dla: <b>${c.borrower}</b></div>
        ${c.comment ? `<div class="small fst-italic text-secondary">${c.comment}</div>` : ''}
        <div class="fw-bold text-end mt-1" style="color:var(--burgund);">${Number(c.amount).toFixed(2)} ${c.currency}</div>
      `;
      container.appendChild(card);
    });
  }
}

document.getElementById("formCost").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("costName").value.trim();
  const amount = parseFloat(document.getElementById("costAmount").value);
  const currency = document.getElementById("costCurrency").value;
  const borrower = document.getElementById("costBorrower").value;
  const comment = document.getElementById("costComment").value.trim();
  const isPrivate = document.getElementById("costIsPrivate").checked;

  if (!name || isNaN(amount) || amount <= 0) return;

  await supabaseClient.from("costs").insert({
    created_by: currentUserId,
    paid_by: currentUser,
    amount: amount,
    currency: currency,
    cost_name: name,
    borrower: borrower,
    comment: comment,
    is_private: isPrivate
  });

  document.getElementById("formCost").reset();
  loadCosts();
});

// ==============================================================================
// 6. MODUŁ: PORTFEL (ROZLICZENIA)
// ==============================================================================
async function loadWallet() {
  const { data: listaW } = await supabaseClient.from("costs").select("*").eq("deleted", false);
  const oweContainer = document.getElementById("walletOweList");
  const dueContainer = document.getElementById("walletDueList");
  const summaryEl = document.getElementById("walletTotalSummary");

  oweContainer.innerHTML = "";
  dueContainer.innerHTML = "";

  let razemPln = 0.0;
  const mamyOddac = [];
  const ktosZalega = [];

  if (listaW) {
    listaW.forEach(w => {
      if (w.is_private) return;

      const kwota = parseFloat(w.amount);
      const wal = w.currency;
      const ktoPlacil = w.paid_by;
      const teamPlacacy = ekipyMapa[ktoPlacil] || "Pakuły";
      const dlaKogo = w.borrower;
      const kursDoPln = bazaKursow[`${wal}_PLN`] || 1.0;

      if (dlaKogo === "Całe Stado") {
        const kosztNaGlowe = kwota / 15.0;
        if (teamPlacacy === currentTeam) {
          Object.entries(LICZBA_OSOB_W_EKIPIE).forEach(([tName, lOsob]) => {
            if (tName === "Całe Stado" || tName === currentTeam) return;
            const szczegol = lOsob * kosztNaGlowe;
            ktosZalega.push(`🧾 ${tName} ➔ <b>${szczegol.toFixed(2)} ${wal}</b>`);
            razemPln += (szczegol * kursDoPln);
          });
        } else {
          const ileUNas = LICZBA_OSOB_W_EKIPIE[currentTeam] || 4;
          const szczegol = ileUNas * kosztNaGlowe;
          mamyOddac.push(`🧾 ${teamPlacacy} ➔ <b>${szczegol.toFixed(2)} ${wal}</b>`);
          razemPln -= (szczegol * kursDoPln);
        }
      } else if (dlaKogo === currentTeam && teamPlacacy !== currentTeam) {
        mamyOddac.push(`🧾 ${teamPlacacy} ➔ <b>${kwota.toFixed(2)} ${wal}</b>`);
        razemPln -= (kwota * kursDoPln);
      } else if (dlaKogo !== currentTeam && teamPlacacy === currentTeam) {
        ktosZalega.push(`🧾 ${dlaKogo} ➔ <b>${kwota.toFixed(2)} ${wal}</b>`);
        razemPln += (kwota * kursDoPln);
      }
    });
  }

  oweContainer.innerHTML = mamyOddac.length ? mamyOddac.join("<br>") : "<i>Czysto! Nie macie zaległości.</i>";
  dueContainer.innerHTML = ktosZalega.length ? ktosZalega.join("<br>") : "<i>Brak zaległości ze strony innych ekip.</i>";

  summaryEl.innerText = `${razemPln >= 0 ? '+ ' : '- '}${Math.abs(razemPln).toFixed(2)} PLN`;
  summaryEl.style.color = razemPln >= 0 ? "green" : "red";
}

// ==============================================================================
// 7. MODUŁ: ZAKUPY
// ==============================================================================
async function loadShoppingLists() {
  const select = document.getElementById("shoppingListSelect");
  select.innerHTML = "";
  const { data } = await supabaseClient.from("shoppinglists").select("*").order("created_at", { ascending: false });

  if (data && data.length > 0) {
    data.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.innerText = `Lista #${l.id} (${l.created_at.substring(0, 16).replace('T', ' ')})`;
      select.appendChild(opt);
    });
    select.onchange = () => loadShoppingItems(select.value);
    loadShoppingItems(data[0].id);
  }
}

async function loadShoppingItems(listId) {
  const container = document.getElementById("shoppingItemsList");
  container.innerHTML = "";
  const { data } = await supabaseClient.from("shoppingitems").select("*").eq("list_id", listId).order("created_at");

  if (data) {
    data.forEach(it => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      li.innerHTML = `
        <span>${it.bought ? `<s>${it.product_name}</s>` : it.product_name}</span>
        <input type="checkbox" class="form-check-input" ${it.bought ? 'checked' : ''}>
      `;
      li.querySelector("input").onchange = async (e) => {
        await supabaseClient.from("shoppingitems").update({ bought: e.target.checked }).eq("id", it.id);
        loadShoppingItems(listId);
      };
      container.appendChild(li);
    });
  }
}

document.getElementById("btnNewShoppingList").onclick = async () => {
  await supabaseClient.from("shoppinglists").insert({ created_by: currentUserId });
  loadShoppingLists();
};

document.getElementById("btnAddProduct").onclick = async () => {
  const input = document.getElementById("newProductInput");
  const listId = document.getElementById("shoppingListSelect").value;
  if (!input.value.trim() || !listId) return;

  await supabaseClient.from("shoppingitems").insert({ list_id: listId, product_name: input.value.trim(), bought: false });
  input.value = "";
  loadShoppingItems(listId);
};

// ==============================================================================
// 8. MODUŁ: PŁACIMY RAZEM, KANTOR I FORUM
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
      <li>🦫 <b>Bobry (3 os.):</b> ${bKoszt.toFixed(2)} ${wal}</li>
      <li>🐗 <b>Pakuły (4 os.):</b> ${pKoszt.toFixed(2)} ${wal}</li>
      <li>🪱 <b>Robaki (4 os.):</b> ${rKoszt.toFixed(2)} ${wal}</li>
      <li>⛰️ <b>Sileziny (4 os.):</b> ${sKoszt.toFixed(2)} ${wal}</li>
    </ul>
  `;
}

function przeliczKantor() {
  const amt = parseFloat(document.getElementById("exAmount").value) || 0;
  const from = document.getElementById("exFrom").value;
  const to = document.getElementById("exTo").value;
  const rate = bazaKursow[`${from}_${to}`] || 1.0;
  const res = amt * rate;

  document.getElementById("exResult").innerHTML = `
    <div class="small text-muted mb-1">1 ${from} = ${rate.toFixed(4)} ${to}</div>
    <div class="fs-4 fw-bold" style="color:var(--burgund);">${res.toFixed(2)} ${to}</div>
  `;
}

async function loadForum() {
  const container = document.getElementById("forumMessages");
  container.innerHTML = "";
  const { data } = await supabaseClient.from("forum").select("comment, created_by, users(login)").order("created_at", { ascending: false });

  if (data) {
    data.forEach(f => {
      const author = (f.users && f.users.login) ? f.users.login : "Ekipa";
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${author === currentUser ? 'chat-bubble-sent' : 'chat-bubble-received'}`;
      bubble.innerHTML = `<div class="fw-bold small" style="color:var(--burgund);">${author}</div><div>${f.comment}</div>`;
      container.appendChild(bubble);
    });
  }
}

document.getElementById("btnSendForum").onclick = async () => {
  const input = document.getElementById("forumInput");
  if (!input.value.trim()) return;

  await supabaseClient.from("forum").insert({ created_by: currentUserId, comment: input.value.trim() });
  input.value = "";
  loadForum();
};

// ==============================================================================
// 9. EVENT LISTENERS
// ==============================================================================
function setupEventListeners() {
  document.getElementById("btnModePrep").onclick = () => {
    currentMode = "Przygotowanie";
    document.getElementById("btnModePrep").className = "btn btn-burgund";
    document.getElementById("btnModeTrip").className = "btn btn-outline-danger";
    renderNavigation();
  };

  document.getElementById("btnModeTrip").onclick = () => {
    currentMode = "Na wyjeździe";
    document.getElementById("btnModeTrip").className = "btn btn-burgund";
    document.getElementById("btnModePrep").className = "btn btn-outline-danger";
    renderNavigation();
  };

  document.getElementById("btnCenterHome").onclick = () => {
    if (mapInstance) mapInstance.setView([DOM_LAT, DOM_LNG], 12);
  };

  ["calcNormal", "calcReduced", "calcCurrency"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", przeliczBilety);
  });

  ["exAmount", "exFrom", "exTo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", przeliczKantor);
  });
}