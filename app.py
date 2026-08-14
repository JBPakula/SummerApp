# app.py
from datetime import datetime, timezone
import os
import base64
import streamlit as st
import folium
from streamlit_folium import st_folium
import requests
from supabase import create_client, Client
from streamlit_cookies_controller import CookieController

# ==============================================================================
# 1. KONFIGURACJA STRONY (Musi być ZAWSZE pierwszą komendą Streamlit)
# ==============================================================================
st.set_page_config(
    page_title="Wakacje Stada",
    page_icon="assets/logo.png",
    layout="centered",
    initial_sidebar_state="collapsed"
)

# ==============================================================================
# 2. METATAGI (Ikona na telefon) ORAZ STYLE CSS
# ==============================================================================
st.markdown(
    """
    <head>
        <link rel="apple-touch-icon" href="assets/logo.png">
        <link rel="icon" type="image/png" sizes="192x192" href="assets/logo.png">
    </head>
    """,
    unsafe_allow_html=True
)

def wczytaj_style_css():
    sciezka_css = os.path.join("style", "custom.css")
    if os.path.exists(sciezka_css):
        with open(sciezka_css, "r", encoding="utf-8") as f:
            st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

wczytaj_style_css()

# ==============================================================================
# 3. POŁĄCZENIE Z BAZĄ DANYCH (SUPABASE)
# ==============================================================================
URL_SUPABASE = st.secrets["SUPABASE_URL"]
KEY_SUPABASE = st.secrets["SUPABASE_KEY"]

@st.cache_resource
def inicjalizuj_supabase() -> Client:
    return create_client(URL_SUPABASE, KEY_SUPABASE)

supabase = inicjalizuj_supabase()

# ==============================================================================
# 4. MECHANIZM LOGOWANIA I UTRZYMANIA SESJI
# ==============================================================================
cookie_controller = CookieController()

# A. Sprawdzenie parametru w linku URL (?uzytkownik=Imie)
param_user = st.query_params.get("uzytkownik")
if param_user and "current_user" not in st.session_state:
    st.session_state["logged_in"] = True
    st.session_state["current_user"] = param_user

# B. Sprawdzenie zapisanego ciasteczka w przeglądarce
saved_user = cookie_controller.get("logged_user")
if saved_user and not st.session_state.get("logged_in", False):
    st.session_state["logged_in"] = True
    st.session_state["current_user"] = saved_user

# C. Ekran logowania (jeśli nikt nie jest jeszcze zalogowany)
if not st.session_state.get("logged_in", False):
    st.markdown("<h1 style='text-align: center;'>Wakacje Stada</h1>", unsafe_allow_html=True)
    
    # Lista użytkowników pobierana dynamicznie lub ze zdefiniowanej listy
    lista_osob = ["Asia", "Kasia", "Tomek", "Inny użytkownik"]
    selected_user = st.selectbox("Kim jesteś?", options=lista_osob)
    
    # Pole tekstowe (bez type="password", żeby Chrome nie rzucał czerwonym alertem o wycieku haseł)
    kod_dostepu = st.text_input("Kod dostępu / Hasło:")
    
    if st.button("Wejdź do aplikacji"):
        if kod_dostepu:  # Tutaj następuje weryfikacja poprawności
            st.session_state["logged_in"] = True
            st.session_state["current_user"] = selected_user
            
            # Zapisanie ciasteczka na 60 dni
            cookie_controller.set("logged_user", selected_user, max_age=60*24*60*60)
            
            # Zapisanie parametru w pasku adresu (pozwala zapisać zakładkę w telefonie)
            st.query_params["uzytkownik"] = selected_user
            st.rerun()
        else:
            st.warning("Podaj kod dostępu.")
    
    st.stop()  # Zatrzymanie renderowania reszty aplikacji przed zalogowaniem

# --- MATRYCE SYSTEMOWE (POBIERANIE Z SECRETS) ---
HASLA = st.secrets["passwords"]


LICZBA_OSOB_W_EKIPIE = {"Całe Stado": 15, "Bobry": 3, "Pakuły": 4, "Robaki": 4, "Sileziny": 4}

@st.cache_data(ttl=600)
def pobierz_profil_i_malzenstwa_z_bazy():
    malzenstwa_mapa = {}
    ekipy_mapa = {}
    try:
        try: users_data = supabase.table("users").select("id, login, spouse_id, team").execute().data or []
        except: users_data = supabase.table("Users").select("id, login, spouse_id, team").execute().data or []
        
        id_to_login = {u["id"]: u["login"] for u in users_data}
        for u in users_data:
            login = u["login"]
            ekipy_mapa[login] = u.get("team", "Pakuły")
            s_id = u.get("spouse_id")
            if s_id and s_id in id_to_login:
                malzenstwa_mapa[login] = id_to_login[s_id]
    except:
        pass
    return malzenstwa_mapa, ekipy_mapa

MALZENSTWA, EKIPY = pobierz_profil_i_malzenstwa_z_bazy()

# --- INICJALIZACJA STANÓW ---
if "zalogowany_user" not in st.session_state:
    st.session_state.zalogowany_user = None
if "user_id" not in st.session_state:
    st.session_state.user_id = None
if "map_center" not in st.session_state:
    st.session_state.map_center = [47.8522, 20.3297]
if "map_zoom" not in st.session_state:
    st.session_state.map_zoom = 11
if "map_refresh_key" not in st.session_state:
    st.session_state.map_refresh_key = 0
if "wybrana_zakladka" not in st.session_state:
    st.session_state.wybrana_zakladka = "🗺️ Mapa"
if "tryb_aplikacji" not in st.session_state:
    st.session_state.tryb_aplikacji = "Na wyjeździe"
if "pokaz_formularz_mapy" not in st.session_state:
    st.session_state.pokaz_formularz_mapy = False
if "ostatnie_lat_lng" not in st.session_state:
    st.session_state.ostatnie_lat_lng = None

# Autologowanie
if st.session_state.zalogowany_user is None:
    ciasteczka = cookie_controller.getAll()
    if isinstance(ciasteczka, dict) and "stado_user" in ciasteczka:
        st.session_state.zalogowany_user = ciasteczka["stado_user"]
        st.session_state.user_id = int(ciasteczka.get("stado_uid", 0))
        st.rerun()

# LOGOWANIE
if st.session_state.zalogowany_user is None:
    st.markdown(
        """
        <div style='margin-top: 40px;'>
            <h1 class="login-header-title">Wakacje Stada</h1>
        </div>
    """,
        unsafe_allow_html=True,
    )

    with st.form("logowanie_form"):
        wybrane_imie = st.selectbox("Kim jesteś?", list(HASLA.keys()))
        wpisane_haslo = st.text_input("Hasło:", key="pole_haslo")
        przycisk_zaloguj = st.form_submit_button(
            "Wejdź do aplikacji", use_container_width=True
        )

        if przycisk_zaloguj:
            prawidlowe_haslo = str(HASLA.get(wybrane_imie, "")).strip()

            if wpisane_haslo.strip() != prawidlowe_haslo:
                st.error("❌ Nieprawidłowe hasło! Spróbuj ponownie.")
            else:
                try:
                    res = (
                        supabase.table("users")
                        .select("id, login")
                        .ilike("login", wybrane_imie)
                        .execute()
                    )

                    if res.data and len(res.data) > 0:
                        uid = res.data[0]["id"]
                        st.session_state.user_id = uid
                        st.session_state.zalogowany_user = wybrane_imie

                        # Zapis ciasteczek z obsługą strefy czasowej UTC
                        expires_date = datetime(
                            2026, 8, 31, 23, 59, 59, tzinfo=timezone.utc
                        )
                        try:
                            cookie_manager.set(
                                "stado_user",
                                wybrane_imie,
                                expires_at=expires_date,
                                key="set_user",
                            )
                            cookie_manager.set(
                                "stado_uid",
                                str(uid),
                                expires_at=expires_date,
                                key="set_uid",
                            )
                        except Exception:
                            pass

                        st.success(f"Witaj {wybrane_imie}! Logowanie...")
                        st.rerun()
                    else:
                        st.error(
                            f"❌ Nie znaleziono użytkownika '{wybrane_imie}' w tabeli 'users' w bazie!"
                        )
                except Exception as e:
                    st.error(f"❌ Błąd połączenia z bazą: {e}")

    st.stop()
    
user_aktualny = st.session_state.zalogowany_user
id_aktualny = st.session_state.user_id
team_aktualny = EKIPY.get(user_aktualny, "Pakuły")


def pobierz_avatar_src(login):
    """Zwraca lokalne zdjęcie zakodowane w base64 lub fallback SVG."""
    katalog = os.path.join("assets", "avatars")
    for ext in [".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"]:
        sciezka = os.path.join(katalog, f"{login}{ext}")
        if os.path.exists(sciezka):
            with open(sciezka, "rb") as img_file:
                b64_data = base64.b64encode(img_file.read()).decode("utf-8")
            mime = "image/png" if ext.lower() == ".png" else "image/jpeg"
            return f"data:{mime};base64,{b64_data}"

    return f"https://api.dicebear.com/7.x/initials/svg?seed={login}"


# Pobieramy zakodowane zdjęcie aktualnego użytkownika
avatar_url = pobierz_avatar_src(user_aktualny)

# --- LEWY PANEL BOCZNY (SIDEBAR) ---
st.sidebar.markdown(f"""
    <div class="sidebar-profile-card">
        <img src="{avatar_url}">
        <h4 style="margin: 10px 0 2px 0; color: #2D2D2D;">{user_aktualny} 👋</h4>
        <span style="color: #666; font-size: 13px;">Team: <b style="color:#8B0000;">{team_aktualny}</b></span>
    </div>
""", unsafe_allow_html=True)

# LISTA ZAKŁADEK NAWIGACYJNYCH (WYŁĄCZNIE W SIDEBARZE)
if st.session_state.tryb_aplikacji == "Przygotowanie":
    zakladki_nawigacja = ["🗺️ Mapa", "🧳 Pakowanie", "💱 Kantor", "💬 Forum"]
else:
    zakladki_nawigacja = ["🗺️ Mapa", "💰 Wydatki", "🏦 Portfel", "🛒 Zakupy", "📊 Płacimy Razem", "💱 Kantor", "🎲 Rozgrywki", "💬 Forum"]

st.sidebar.markdown("<div style='margin-top: 15px;'></div>", unsafe_allow_html=True)
for zak in zakladki_nawigacja:
    klasa_stylu = "primary" if st.session_state.wybrana_zakladka == zak else "secondary"
    if st.sidebar.button(zak, key=f"nav_btn_{zak}", use_container_width=True, type=klasa_stylu):
        st.session_state.wybrana_zakladka = zak
        st.rerun()

st.sidebar.markdown("<hr style='margin: 20px 0; border: 0; border-top: 1px solid #C5BCB0;'>", unsafe_allow_html=True)
if st.sidebar.button("🚪 Wyloguj się", use_container_width=True):
    cookie_manager.delete("stado_user")
    cookie_manager.delete("stado_uid")
    st.session_state.zalogowany_user = None
    st.session_state.user_id = None
    st.rerun()

# --- DYNAMICZNY PRZEŁĄCZNIK TRYBÓW NA SAMEJ GÓRZE STRONY GŁÓWNEJ ---
st.markdown("<div style='margin-top: 10px;'></div>", unsafe_allow_html=True)
c_mod1, c_mod2 = st.columns([1, 1])
with c_mod1:
    if st.button("⛺ Przygotowanie", use_container_width=True, type="primary" if st.session_state.tryb_aplikacji == "Przygotowanie" else "secondary"):
        st.session_state.tryb_aplikacji = "Przygotowanie"
        if st.session_state.wybrana_zakladka not in ["🗺️ Mapa", "🧳 Pakowanie", "💱 Kantor", "💬 Forum"]:
            st.session_state.wybrana_zakladka = "🗺️ Mapa"
        st.rerun()
with c_mod2:
    if st.button("🍇 Na wyjeździe", use_container_width=True, type="primary" if st.session_state.tryb_aplikacji == "Na wyjeździe" else "secondary"):
        st.session_state.tryb_aplikacji = "Na wyjeździe"
        st.rerun()

# Nowoczesny i czysty nagłówek bez dzika
st.markdown("<h2 class='modern-title'>Wakacje Stada</h2>", unsafe_allow_html=True)

# --- GLOBALNY BACKUP KURSÓW ---
try:
    res_k = requests.get("https://api.frankfurter.app/latest?from=EUR&to=PLN,HUF").json()
    kurs_eur_pln, kurs_eur_huf = res_k["rates"]["PLN"], res_k["rates"]["HUF"]
    baza_kursow_global = {
        ("PLN", "HUF"): kurs_eur_huf / kurs_eur_pln, ("HUF", "PLN"): kurs_eur_pln / kurs_eur_huf,
        ("PLN", "EUR"): 1 / kurs_eur_pln, ("EUR", "PLN"): kurs_eur_pln,
        ("EUR", "HUF"): kurs_eur_huf, ("HUF", "EUR"): 1 / kurs_eur_huf,
        ("PLN", "PLN"): 1.0, ("HUF", "HUF"): 1.0, ("EUR", "EUR"): 1.0
    }
except:
    baza_kursow_global = {
        ("PLN", "HUF"): 85.20, ("HUF", "PLN"): 0.0117, ("PLN", "EUR"): 0.23, 
        ("EUR", "PLN"): 4.32, ("EUR", "HUF"): 368.0, ("HUF", "EUR"): 0.0027,
        ("PLN", "PLN"): 1.0, ("HUF", "HUF"): 1.0, ("EUR", "EUR"): 1.0
    }

# ==========================================
# 1. WIDOK: MAPA
# ==========================================
if st.session_state.wybrana_zakladka == "🗺️ Mapa":
    st.subheader("🗺️ Wakacyjne Punkty")
    try: punkty = supabase.table("map").select("*").execute().data or []
    except:
        try: punkty = supabase.table("Map").select("*").execute().data or []
        except: punkty = []

    lat_domu, lng_domu = 47.8522, 20.3297
    m = folium.Map(location=st.session_state.map_center, zoom_start=st.session_state.map_zoom)
    
    html_dom = '<div style="font-family:Arial; font-size:12px; min-width:130px;"><b>🏠 Ámbitus ház</b><br>Sáfrány út 38/a</div>'
    folium.Marker([lat_domu, lng_domu], popup=folium.Popup(html_dom, max_width=200), tooltip="Nasz Dom!", icon=folium.Icon(color="orange", icon="star")).add_to(m)

    for p in punkty:
        lat, lng = p.get("lat") or lat_domu, p.get("lng") or lat_domu
        kat = str(p.get("category")).lower()
        kolor = "blue" if "term" in kat else "red" if "zwiedz" in kat else "green"
        
        html_content = f"<div style='font-family:Arial; font-size:12px;'><b>#{p['id']} {p['name']}</b><br>{p['address']}</div>"
        folium.Marker([lat, lng], popup=folium.Popup(html_content, max_width=200), tooltip=f"#{p['id']} {p['name']}", icon=folium.Icon(color=kolor)).add_to(m)
        
    dane_mapy = st_folium(m, width="100%", height=350, key=f"mapa_stada_ref_{st.session_state.map_refresh_key}")
    
    if dane_mapy and dane_mapy.get("last_clicked"):
        lat_c = dane_mapy["last_clicked"]["lat"]
        lng_c = dane_mapy["last_clicked"]["lng"]
        st.session_state.ostatnie_lat_lng = (lat_c, lng_c)
        st.session_state.pokaz_formularz_mapy = True
        st.rerun()

    # NAKŁADKA MODALNA (POPUP FORMULARZ)
    if st.session_state.pokaz_formularz_mapy and st.session_state.ostatnie_lat_lng:
        lat_c, lng_c = st.session_state.ostatnie_lat_lng
        
        st.markdown(f"""
            <div class="modal-overlay">
                <div class="modal-content">
                    <h3 style='margin-top:0; color:#8B0000; text-align:center;'>📍 Dodaj nowe miejsce</h3>
                    <p style='text-align:center; color:#2D2D2D;'>Współrzędne: <b>{lat_c:.4f}, {lng_c:.4f}</b></p>
                </div>
            </div>
        """, unsafe_allow_html=True)
        
        with st.form("dodaj_miejsce_form"):
            nazwa_miejsca = st.text_input("Nazwa nowej pinezki:")
            kat_miejsca = st.selectbox("Typ:", ["termy", "zwiedzanie", "knajpa", "inne"])
            col_save, col_close = st.columns(2)
            
            with col_save:
                zapisano = st.form_submit_button("💾 Zapisz", use_container_width=True)
            with col_close:
                anulowano = st.form_submit_button("❌ Anuluj", use_container_width=True)
                
            if zapisano and nazwa_miejsca:
                try: supabase.table("map").insert({"name": nazwa_miejsca, "category": kat_miejsca, "address": f"Szer: {lat_c:.4f}, Dł: {lng_c:.4f}", "lat": lat_c, "lng": lng_c, "created_by": id_aktualny}).execute()
                except: supabase.table("Map").insert({"name": nazwa_miejsca, "category": kat_miejsca, "address": f"Szer: {lat_c:.4f}, Dł: {lng_c:.4f}", "lat": lat_c, "lng": lng_c, "created_by": id_aktualny}).execute()
                st.session_state.pokaz_formularz_mapy = False
                st.session_state.ostatnie_lat_lng = None
                st.rerun()
            if anulowano:
                st.session_state.pokaz_formularz_mapy = False
                st.session_state.ostatnie_lat_lng = None
                st.rerun()

    st.markdown("---")
    if st.button("🏠 Powróć do widoku Domu", use_container_width=True):
        st.session_state.map_center = [lat_domu, lng_domu]
        st.session_state.map_zoom = 11
        st.session_state.map_refresh_key += 1
        st.rerun()

    st.markdown("### 🏠 NASZ ADRES:")
    if st.button("⛺ Ámbitus ház — Sáfrány út 38/a, Egerszalók", key="ln_adr_home", use_container_width=True):
        st.session_state.map_center = [lat_domu, lng_domu]
        st.session_state.map_zoom = 16
        st.session_state.map_refresh_key += 1
        st.rerun()
    
    st.markdown("### 📌 Spis atrakcji:")
    for p in punkty:
        if st.button(f"🌐 #{p['id']} - {p['name']} ({p['category']})", key=f"ln_map_{p['id']}", use_container_width=True):
            st.session_state.map_center = [p["lat"], p["lng"]]
            st.session_state.map_zoom = 16
            st.session_state.map_refresh_key += 1
            st.rerun()

# ==========================================
# 2. WIDOK: WYDATKI
# ==========================================
elif st.session_state.wybrana_zakladka == "💰 Wydatki":
    st.subheader("💰 Wydatki Stada")
    try: lista_w = supabase.table("costs").select("*").eq("deleted", False).order("created_at", desc=True).execute().data or []
    except:
        try: lista_w = supabase.table("Costs").select("*").eq("deleted", False).order("created_at", desc=True).execute().data or []
        except: lista_w = []

    with st.form("form_koszt"):
        st.markdown("<h4 style='color: #8B0000; margin-top: 0;'>➕ Dodaj nowy wydatek</h4>", unsafe_allow_html=True)
        nazwa_kosztu = st.text_input("Za co?", key="wydatek_nazwa")
        kwota_kosztu = st.number_input("Ile?", min_value=0.0, step=5.0, format="%.2f")
        waluta_kosztu = st.selectbox("Waluta:", ["HUF", "PLN", "EUR"])
        dla_kogo = st.selectbox("Dla kogo (Ekipa):", ["Całe Stado", "Bobry", "Sileziny", "Robaki", "Pakuły"])
        komentarz_kosztu = st.text_input("Komentarz:")
        is_private = st.checkbox("🔒 Prywatny wydatek (widoczny tylko dla pary)")
        
        if st.form_submit_button("Zapisz wydatek", use_container_width=True) and nazwa_kosztu and kwota_kosztu > 0:
            try: supabase.table("costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_kosztu, "currency": waluta_kosztu, "cost_name": nazwa_kosztu, "borrower": dla_kogo, "is_private": is_private, "comment": komentarz_kosztu}).execute()
            except: supabase.table("Costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_kosztu, "currency": waluta_kosztu, "cost_name": nazwa_kosztu, "borrower": dla_kogo, "is_private": is_private, "comment": komentarz_kosztu}).execute()
            st.rerun()

    for w in lista_w:
        if w.get("is_private"):
            dostepni_userzy = [w["paid_by"], MALZENSTWA.get(w["paid_by"])]
            if user_aktualny not in dostepni_userzy: continue
            
        klasa_karty = "stado-card-private" if w.get("is_private") else "stado-card"
        ikona_prywatnosci = "🔒 [Prywatne] " if w.get("is_private") else ""
        komentarz_html = f"<div style='font-style: italic; color: #555555; font-size:13px; margin-top:4px;'>Komentarz: {w['comment']}</div>" if w.get("comment") else ""
        
        st.markdown(f"""
            <div class="{klasa_karty}">
                <div class="stado-card-title">{ikona_prywatnosci}{w['cost_name']}</div>
                <div class="stado-card-meta">Płacił(a): <b style="color: #2D2D2D;">{w['paid_by']}</b> dla: <b style="color: #2D2D2D;">{w['borrower']}</b></div>
                {komentarz_html}
                <div class="stado-card-amount">{w['amount']:.2f} {w['currency']}</div>
            </div>
        """, unsafe_allow_html=True)

# ==========================================
# 3. WIDOK: PORTFEL
# ==========================================
elif st.session_state.wybrana_zakladka == "🏦 Portfel":
    st.markdown(f"### 🏦 Bilans dla: **{team_aktualny}**")
    
    try: lista_w = supabase.table("costs").select("*").eq("deleted", False).execute().data or []
    except:
        try: lista_w = supabase.table("Costs").select("*").eq("deleted", False).execute().data or []
        except: lista_w = []

    mamy_oddac = []
    ktos_zalega = []
    razem_pln = 0.0

    for w in lista_w:
        if w.get("is_private"): continue
        
        kwota = float(w["amount"])
        wal = w["currency"]
        kto_placil = w["paid_by"]
        team_placacy = EKIPY.get(kto_placil, "Pakuły")
        dla_kogo = w["borrower"]
        
        kurs_do_pln = baza_kursow_global.get((wal, "PLN"), 1.0)

        if dla_kogo == "Całe Stado":
            koszt_na_glowe = kwota / 15
            
            if team_placacy == team_aktualny:
                for t_name, l_osob in LICZBA_OSOB_W_EKIPIE.items():
                    if t_name == "Całe Stado" or t_name == team_aktualny: continue
                    szczegol_kwota = l_osob * koszt_na_glowe
                    ktos_zalega.append(f"🧾 {t_name} ➔ <b>{szczegol_kwota:,.2f} {wal}</b>")
                    razem_pln += (szczegol_kwota * kurs_do_pln)
            else:
                ile_osob_u_nas = LICZBA_OSOB_W_EKIPIE.get(team_aktualny, 4)
                szczegol_kwota = ile_osob_u_nas * koszt_na_glowe
                mamy_oddac.append(f"🧾 {team_placacy} ➔ <b>{szczegol_kwota:,.2f} {wal}</b>")
                razem_pln -= (szczegol_kwota * kurs_do_pln)

        elif dla_kogo == team_aktualny and team_placacy != team_aktualny:
            mamy_oddac.append(f"🧾 {team_placacy} ➔ <b>{kwota:,.2f} {wal}</b>")
            razem_pln -= (kwota * kurs_do_pln)
            
        elif dla_kogo != team_aktualny and team_placacy == team_aktualny:
            ktos_zalega.append(f"🧾 {dla_kogo} ➔ <b>{kwota:,.2f} {wal}</b>")
            razem_pln += (kwota * kurs_do_pln)

    st.markdown("### 🔴 Mamy oddać:")
    if mamy_oddac:
        for item in mamy_oddac: st.markdown(item, unsafe_allow_html=True)
    else: st.write("*Czysto! Nie macie zaległości.*")

    st.markdown("### 🟢 Ktoś nam zalega:")
    if ktos_zalega:
        for item in ktos_zalega: st.markdown(item, unsafe_allow_html=True)
    else: st.write("*Brak zaległości ze strony innych rodzin.*")

    st.markdown("---")
    if razem_pln >= 0:
        st.metric(label="📊 Bilans końcowy (RAZEM)", value=f"+ {razem_pln:,.2f} PLN")
    else:
        st.metric(label="📊 Bilans końcowy (RAZEM)", value=f"- {abs(razem_pln):,.2f} PLN")

# ==========================================
# 4. WIDOK: ZAKUPY
# ==========================================
elif st.session_state.wybrana_zakladka == "🛒 Zakupy":
    st.subheader("🛒 Listy Zakupów Stada")
    
    try: wszystkie_listy = supabase.table("shoppinglists").select("*").order("created_at", desc=True).execute().data or []
    except: wszystkie_listy = []
    
    c_l1, c_l2 = st.columns([2, 3])
    with c_l1:
        if st.button("➕ Nowa lista", use_container_width=True):
            supabase.table("shoppinglists").insert({"created_by": id_aktualny}).execute()
            st.rerun()
            
    with c_l2:
        opcje_list = {l["id"]: f"Lista #{l['id']} ({l['created_at'][:16].replace('T', ' ')})" for l in wszystkie_listy}
        wybrana_lista_id = st.selectbox("Wybierz listę:", list(opcje_list.keys()), format_func=lambda x: opcje_list[x])

    if wybrana_lista_id:
        klucz_blokady = f"lista_zamknieta_{wybrana_lista_id}"
        czy_edytowalna = not st.session_state.get(klucz_blokady, False)
        
        if czy_edytowalna:
            with st.form("dodaj_prod_form", clear_on_submit=True):
                nowy_prod = st.text_input("Dodaj produkt:")
                if st.form_submit_button("Dodaj produkt", use_container_width=True) and nowy_prod:
                    supabase.table("shoppingitems").insert({"list_id": wybrana_lista_id, "product_name": nowy_prod, "bought": False}).execute()
                    st.rerun()

        items = supabase.table("shoppingitems").select("*").eq("list_id", wybrana_lista_id).order("created_at").execute().data or []
        wszystkie_zaznaczone = True if items else False
        
        for it in items:
            stan_checkbox = st.checkbox(it["product_name"], value=it["bought"], key=f"item_{it['id']}", disabled=not czy_edytowalna)
            if czy_edytowalna and stan_checkbox != it["bought"]:
                supabase.table("shoppingitems").update({"bought": stan_checkbox}).eq("id", it["id"]).execute()
                st.rerun()
            if not it["bought"]:
                wszystkie_zaznaczone = False

        if items and wszystkie_zaznaczone and czy_edytowalna:
            st.markdown("---")
            st.success("🛒 Wszystkie produkty zebrane! Wprowadź paragon:")
            with st.form("form_rozlicz_zakupy"):
                kwota_z = st.number_input("Kwota z paragonu:", min_value=0.0, step=10.0, format="%.2f")
                waluta_z = st.selectbox("Waluta paragonu:", ["HUF", "PLN", "EUR"])
                rozlicz_z = st.selectbox("Z kim rozliczyć te zakupy:", ["Całe Stado", "Bobry", "Sileziny", "Robaki", "Pakuły"])
                
                if st.form_submit_button("👍 Zamknij listę i rozlicz", use_container_width=True):
                    if kwota_z > 0:
                        try: supabase.table("costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_z, "currency": waluta_z, "cost_name": f"Zakupy z Listy #{wybrana_lista_id}", "borrower": rozlicz_z, "is_private": False}).execute()
                        except: supabase.table("Costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_z, "currency": waluta_z, "cost_name": f"Zakupy z Listy #{wybrana_lista_id}", "borrower": rozlicz_z, "is_private": False}).execute()
                        st.session_state[klucz_blokady] = True
                        st.rerun()
        
        if not czy_edytowalna:
            st.info("🔒 Ta lista zakupów została rozliczona i zamknięta.")

# ==========================================
# 5. WIDOK: PŁACIMY RAZEM
# ==========================================
elif st.session_state.wybrana_zakladka == "📊 Płacimy Razem":
    st.subheader("📊 Płacimy Razem - Kalkulator")
    waluta_atr = st.selectbox("Waluta biletów:", ["HUF", "PLN", "EUR"], key="wal_atr_razem")
    c_normalny = st.number_input("Cena biletu normalnego:", min_value=0.0, step=100.0, format="%.2f")
    c_ulgowy = st.number_input("Cena biletu ulgowego:", min_value=0.0, step=100.0, format="%.2f")

    if c_normalny > 0:
        if c_ulgowy == 0:
            koszt_calkowity = 15 * c_normalny
            b_koszt, p_koszt, r_koszt, s_koszt = 3 * c_normalny, 4 * c_normalny, 4 * c_normalny, 4 * c_normalny
        else:
            koszt_calkowity = 8 * c_normalny + 7 * c_ulgowy
            b_koszt = 2 * c_normalny + 1 * c_ulgowy
            p_koszt, r_koszt, s_koszt = 2 * c_normalny + 2 * c_ulgowy, 2 * c_normalny + 2 * c_ulgowy, 2 * c_normalny + 2 * c_ulgowy

        st.markdown(f"### 💰 Razem biletowo: <span style='color:#8B0000;'>{koszt_calkowity:,.2f} {waluta_atr}</span>".replace(",", " "), unsafe_allow_html=True)
        st.write(f"🦫 **Bobry (3 os.):** {b_koszt:,.2f} {waluta_atr}".replace(",", " "))
        st.write(f"🐗 **Pakuły (4 os.):** {p_koszt:,.2f} {waluta_atr}".replace(",", " "))
        st.write(f"🪱 **Robaki (4 os.):** {r_koszt:,.2f} {waluta_atr}".replace(",", " "))
        st.write(f"⛰️ **Sileziny (4 os.):** {s_koszt:,.2f} {waluta_atr}".replace(",", " "))

# ==========================================
# 6. WIDOK: KANTOR
# ==========================================
elif st.session_state.wybrana_zakladka == "💱 Kantor":
    st.subheader("💱 Kantor i Kursy Wymiany")
    
    with st.form("kantor_form"):
        kwota_wejsciowa = st.number_input("Wpisz kwotę do przeliczenia:", min_value=0.0, value=100.0, step=10.0, format="%.2f")
        val_z = st.selectbox("Z waluty:", ["PLN", "HUF", "EUR"])
        val_do = st.selectbox("Na walutę:", ["PLN", "HUF", "EUR"], index=1)
        
        kurs_oficjalny = baza_kursow_global.get((val_z, val_do), 1.0)
        st.markdown(f"📈 *Średni kurs rynkowy: 1 {val_z} = {kurs_oficjalny:.4f} {val_do}*")
        
        uzyj_wlasnego = st.checkbox("Użyj własnego kursu wymiany")
        kurs_koncowy = st.number_input("Twój kurs wymiany:", min_value=0.0, value=float(kurs_oficjalny), format="%.4f")
        
        przelicz = st.form_submit_button("💱 Przelicz kwotę", use_container_width=True)

    if val_z != val_do:
        kurs_wymiany = kurs_koncowy if uzyj_wlasnego else kurs_oficjalny
        baza_kursow_global[(val_z, val_do)] = kurs_wymiany
        baza_kursow_global[(val_do, val_z)] = 1.0 / kurs_wymiany
        
        wynik = kwota_wejsciowa * kurs_wymiany
        st.markdown(f"""
            <div style='background-color:#FFF2F2; border: 2px solid #8B0000; padding:20px; border-radius:16px; margin-top:20px; text-align:center;'>
                <h4 style='margin:0 0 5px 0; color:#2D2D2D;'>Wynik po przeliczeniu:</h4>
                <div style='font-size:26px; font-weight:800; color:#8B0000;'>{wynik:,.2f} {val_do}</div>
            </div>
        """.replace(",", " "), unsafe_allow_html=True)

# ==========================================
# 7. WIDOK: ROZGRYWKI
# ==========================================
elif st.session_state.wybrana_zakladka == "🎲 Rozgrywki":
    st.subheader("🎲 Turnieje i Gry Stada")
    
    gra_wybrana = st.selectbox("Wybierz grę:", ["Blocus", "Tysiąc", "Remik", "Inne"], key="wyb_gre_m")
    gracze_m = st.multiselect("Wybierz graczy:", list(HASLA.keys()))
    
    if st.button("🎬 Rozpocznij nową partię", use_container_width=True) and gracze_m:
        nowa_gra = supabase.table("games").insert({"game_name": gra_wybrana, "finished": False}).execute().data
        if nowa_gra:
            g_id = nowa_gra[0]["id"]
            for g in gracze_m:
                supabase.table("gamescores").insert({"game_id": g_id, "player_name": g, "round_number": 1, "points": 0}).execute()
        st.rerun()

    if gracze_m:
        try: aktywne_gry = supabase.table("games").select("*").eq("game_name", gra_wybrana).eq("finished", False).order("created_at", desc=True).limit(1).execute().data
        except: aktywne_gry = []
        
        if aktywne_gry:
            ag_id = aktywne_gry[0]["id"]
            st.markdown(f"### 🕹️ Aktywna Partia: **{aktywne_gry[0]['game_name']}**")
            
            punkty_rundy = supabase.table("gamescores").select("*").eq("game_id", ag_id).execute().data or []
            if punkty_rundy:
                rundy_lista = list(set([r["round_number"] for r in punkty_rundy]))
                max_runda = max(rundy_lista) if rundy_lista else 1
                
                for rnd in sorted(rundy_lista):
                    czy_zablokowane = (rnd < max_runda)
                    st.markdown(f"**Runda {rnd}** " + ("🔒 *(Zablokowana)*" if czy_zablokowane else "✍️ *(Aktualna)*"))
                    for p_name in list(set([r["player_name"] for r in punkty_rundy])):
                        rejs = [x for x in punkty_rundy if x["player_name"] == p_name and x["round_number"] == rnd]
                        if rejs:
                            stara_val = rejs[0]["points"]
                            nowe_pkt = st.number_input(f"{p_name} (Runda {rnd})", value=int(stara_val), key=f"g_scr_{rejs[0]['id']}", disabled=czy_zablokowane)
                            if not czy_zablokowane and nowe_pkt != stara_val:
                                supabase.table("gamescores").update({"points": nowe_pkt}).eq("id", rejs[0]["id"]).execute()

                col_r1, col_r2 = st.columns(2)
                if col_r1.button("➕ Następna runda", use_container_width=True):
                    for g in list(set([r["player_name"] for r in punkty_rundy])):
                        supabase.table("gamescores").insert({"game_id": ag_id, "player_name": g, "round_number": max_runda + 1, "points": 0}).execute()
                    st.rerun()
                    
                if col_r2.button("🏁 Zakończ grę", use_container_width=True):
                    sumy = {p: sum([int(x["points"]) for x in punkty_rundy if x["player_name"] == p]) for p in list(set([r["player_name"] for r in punkty_rundy]))}
                    st.markdown("### 🏆 Wyniki Końcowe:")
                    
                    czy_blocus = (aktywne_gry[0]['game_name'].lower() == "blocus")
                    posortowane_wyniki = sorted(sumy.items(), key=lambda item: item[1], reverse=not czy_blocus)
                    
                    for idx, (k, v) in enumerate(posortowane_wyniki, 1):
                        st.write(f"{idx}. 🥇 **{k}**: {v} pkt")
                    supabase.table("games").update({"finished": True}).eq("id", ag_id).execute()

# ==========================================
# 8. WIDOK: PAKOWANIE & FORUM
# ==========================================
elif st.session_state.wybrana_zakladka == "🧳 Pakowanie":
    st.subheader("🧳 Pakowanie Stada")
    with st.form("dodaj_pakowanie"):
        rzecz = st.text_input("Co zabierasz dla ekipy?")
        if st.form_submit_button("Zgłoś do listy pakowania", use_container_width=True) and rzecz:
            try: supabase.table("packing").insert({"created_by": id_aktualny, "comment": f"{user_aktualny} bierze: {rzecz}"}).execute()
            except: supabase.table("Packing").insert({"created_by": id_aktualny, "comment": f"{user_aktualny} bierze: {rzecz}"}).execute()
            st.rerun()
    try:
        paczki = supabase.table("packing").select("*").order("created_at", desc=True).execute().data or []
        for p in paczki: st.write(p["comment"])
    except: pass

elif st.session_state.wybrana_zakladka == "💬 Forum":
    st.subheader("💬 Forum Stada")
    with st.form("wpis_forum"):
        t_wpisu = st.text_input("Napisz ogłoszenie dla Stada:")
        if st.form_submit_button("Wyślij na forum", use_container_width=True) and t_wpisu:
            try: supabase.table("forum").insert({"created_by": id_aktualny, "comment": t_wpisu, "created_at": datetime.now(timezone.utc).isoformat()}).execute()
            except: supabase.table("Forum").insert({"created_by": id_aktualny, "comment": t_wpisu, "created_at": datetime.now(timezone.utc).isoformat()}).execute()
            st.rerun()
    
    try:
        wpisy = supabase.table("forum").select("comment, created_by, Users(login)").order("created_at", desc=True).execute().data or []
        st.markdown('<div class="forum-container">', unsafe_allow_html=True)
        for f in wpisy:
            autor = f.get('Users', {}).get('login', 'Anonim')
            klasa_dymka = "chat-bubble chat-bubble-sent" if autor == user_aktualny else "chat-bubble chat-bubble-received"
            
            st.markdown(f"""
                <div class="{klasa_dymka}">
                    <div class="chat-author">{autor}</div>
                    <div>{f['comment']}</div>
                </div>
            """, unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)
    except: pass

# ==========================================
# ⚙️ STOPKA SYSTEMOWA (STALE NA DOLE)
# ==========================================
st.markdown("<br><br><br>", unsafe_allow_html=True)
st.markdown(f"""
    <div class="footer-fixed">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #111111; font-weight: 700;">
            <div>© JBP — <a href="https://github.com" target="_blank" style="color: #8B0000; text-decoration: none; font-weight: 800;">GitHub</a></div>
            <div>📅 Last edit: <b>16.07.2026 r.</b> | <a href="https://mkysisoznxgssakcegbn.supabase.co/storage/v1/object/sign/assets/Dokumentacja.TXT?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yNjUxNmQ5Zi1mOTMwLTQwN2QtODJmNi00YjU3MGVhZTJhMGYiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJhc3NldHMvRG9rdW1lbnRhY2phLlRYVCIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODM0NTgzNzQsImV4cCI6MTgxNDk5NDM3NH0.zk2NhWJtsgLwgmDSsoaWgeQ4LAIkvUYUKOB8mXiiYlc" style="color: #8B0000; text-decoration: none; font-weight: 800;">📄 Dokumentacja (TXT)</a></div>
        </div>
    </div>
""", unsafe_allow_html=True)