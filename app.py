from datetime import datetime, timezone
import streamlit as st
import folium
from streamlit_folium import st_folium
import requests
from supabase import create_client, Client
import extra_streamlit_components as stx

# --- POŁĄCZENIE Z SUPABASE ---
URL_SUPABASE = "https://mkysisoznxgssakcegbn.supabase.co"
KEY_SUPABASE = "sb_publishable_4lljAeNc5dvmsJG2u1-pgQ_zCnATIE1"

@st.cache_resource
def inicjalizuj_supabase() -> Client:
    return create_client(URL_SUPABASE, KEY_SUPABASE)

supabase = inicjalizuj_supabase()

# Konfiguracja MOBILE FIRST
st.set_page_config(page_title="Wakacje Stada", layout="centered", initial_sidebar_state="expanded")

# Menedżer ciasteczek
cookie_manager = stx.CookieManager()

# --- MATRYCE SYSTEMOWE ---
HASLA = {
    "Asia": "Asia123", "Maciek": "Maciek123", "Justyna": "Justyna123", 
    "Artur": "Artur123", "Gosia": "Gosia123", "Mateusz": "Maciek123",
    "Radek": "Radek123", "Ola": "Ola123"
}

STYLE_AVATAROW = {
    "Asia": "adventurer", "Maciek": "bottts", "Justyna": "pixel-art", 
    "Artur": "avataaars", "Gosia": "lorelei", "Mateusz": "micah", 
    "Radek": "open-peeps", "Ola": "shapes"
}

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

# --- INICJALIZACJA STANÓW DLA INTERAKTYWNEJ MAPY ---
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

# Autologowanie
if st.session_state.zalogowany_user is None:
    zapisany_user = cookie_manager.get("stado_user")
    zapisane_id = cookie_manager.get("stado_uid")
    if zapisany_user and zapisane_id:
        st.session_state.zalogowany_user = zapisany_user
        st.session_state.user_id = int(zapisane_id)

# LOGOWANIE
if st.session_state.zalogowany_user is None:
    st.markdown("<h2 style='text-align: center;'>🐗 Wakacje Stada 2026</h2>", unsafe_allow_html=True)
    with st.form("logowanie_form"):
        wybrane_imie = st.selectbox("Kim jesteś?", list(HASLA.keys()))
        wpisane_haslo = st.text_input("Hasło:", type="password")
        if st.form_submit_button("Wejdź", use_container_width=True) and wpisane_haslo == HASLA[wybrane_imie]:
            try: res = supabase.table("users").select("id").eq("login", wybrane_imie).execute()
            except: res = supabase.table("Users").select("id").eq("login", wybrane_imie).execute()
            if res.data:
                uid = res.data[0]["id"]
                st.session_state.user_id = uid
                st.session_state.zalogowany_user = wybrane_imie
                expires_date = datetime(2026, 8, 31)
                cookie_manager.set("stado_user", wybrane_imie, expires_at=expires_date, key="set_user")
                cookie_manager.set("stado_uid", str(uid), expires_at=expires_date, key="set_uid")
                st.rerun()
    st.stop()

user_aktualny = st.session_state.zalogowany_user
id_aktualny = st.session_state.user_id
team_aktualny = EKIPY.get(user_aktualny, "Pakuły")
avatar_url = f"https://api.dicebear.com/7.x/{STYLE_AVATAROW.get(user_aktualny, 'initials')}/svg?seed={user_aktualny}"

# --- DYNAMICZNY PANEL BOCZNY ---
data_wyjazdu = datetime(2026, 8, 19).date()
dzisiaj = datetime.now().date()
domyslny_tryb_index = 1 if dzisiaj >= data_wyjazdu else 0

st.sidebar.image(avatar_url, width=90)
st.sidebar.header(f"Profil: {user_aktualny} 👋")
st.sidebar.markdown(f"**Twój Team:** `{team_aktualny}`")
st.sidebar.markdown("---")
st.sidebar.subheader("🗺️ Szczegóły wyjazdu")
st.sidebar.info("**Kierunek:** Eger i okolice 🇭🇺\n\n**Termin:** 19–26.08.2026 r.\n\n**Ekipa:** Wakacje Stada 🐗")

dni = (data_wyjazdu - dzisiaj).days
tryb_apki_sidebar = st.sidebar.radio("Tryb aplikacji:", ["Przygotowanie", "Na wyjeździe"], index=domyslny_tryb_index)
tryb_apki = tryb_apki_sidebar

if tryb_apki == "Przygotowanie" and dni > 0:
    st.sidebar.success(f"🎉 Wyjazd już za **{dni}** dni!")
    st.sidebar.warning("Pakujcie się, żeby potem nie było, że ktoś nie zdążył! 🍷")
elif dni == 0:
    st.sidebar.balloons()
    st.sidebar.success("🚀 To dzisiaj! Stado rusza w drogę!")

if st.sidebar.button("🚪 Wyloguj", use_container_width=True):
    cookie_manager.delete("stado_user")
    cookie_manager.delete("stado_uid")
    st.session_state.zalogowany_user = None
    st.session_state.user_id = None
    st.rerun()

# Układ zakładek
if tryb_apki == "Przygotowanie":
    zakladki_nazwy = ["🗺️ Mapa", "🧳 Pakowanie", "💱 Kantor", "💬 Forum"]
else:
    zakladki_nazwy = ["🗺️ Mapa", "💰 Wydatki", "🏦 Portfel", "🛒 Zakupy", "📊 Płacimy Razem", "💱 Kantor", "🎲 Rozgrywki", "💬 Forum"]

tabs = st.tabs(zakladki_nazwy)
t_dict = {name: tabs[idx] for idx, name in enumerate(zakladki_nazwy)}

# --- GLOBALNY BACKUP KURSÓW DLA PORTFELA ---
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
if "🗺️ Mapa" in t_dict:
    with t_dict["🗺️ Mapa"]:
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
            if st.session_state.get("odrzucono_klikniecie", False):
                st.session_state.odrzucono_klikniecie = False
            else:
                lat_c = dane_mapy["last_clicked"]["lat"]
                lng_c = dane_mapy["last_clicked"]["lng"]
                
                st.info(f"📍 Wybrano współrzędne: `{lat_c:.4f}, {lng_c:.4f}`")
                col_dodaj, col_odrzuc = st.columns(2)
                if col_dodaj.button("➕ Dodaj punkt tutaj", use_container_width=True):
                    st.session_state.pokaz_formularz_mapy = True
                
                if col_odrzuc.button("❌ Odrzuć to miejsce", use_container_width=True):
                    st.session_state.pokaz_formularz_mapy = False
                    st.session_state.odrzucono_klikniecie = True
                    st.rerun()

                if st.session_state.get("pokaz_formularz_mapy", False):
                    with st.form("dodaj_miejsce_form"):
                        nazwa_miejsca = st.text_input("Nazwa nowej pinezki:")
                        kat_miejsca = st.selectbox("Typ:", ["termy", "zwiedzanie", "knajpa", "inne"])
                        if st.form_submit_button("Zapisz w bazie", use_container_width=True) and nazwa_miejsca:
                            try: supabase.table("map").insert({"name": nazwa_miejsca, "category": kat_miejsca, "address": f"Szer: {lat_c:.4f}, Dł: {lng_c:.4f}", "lat": lat_c, "lng": lng_c, "created_by": id_aktualny}).execute()
                            except: supabase.table("Map").insert({"name": nazwa_miejsca, "category": kat_miejsca, "address": f"Szer: {lat_c:.4f}, Dł: {lng_c:.4f}", "lat": lat_c, "lng": lng_c, "created_by": id_aktualny}).execute()
                            st.session_state.pokaz_formularz_mapy = False
                            st.success("Punkt zapisany!")
                            st.rerun()
        else:
            st.session_state.odrzucono_klikniecie = False
        
        st.markdown("---")
        if st.button("🏠 Resetuj i powróć do widoku Domu", use_container_width=True):
            st.session_state.map_center = [lat_domu, lng_domu]
            st.session_state.map_zoom = 11
            st.session_state.map_refresh_key += 1
            st.rerun()

        st.markdown("### 🏠 NASZ ADRES:")
        if st.button("⛺ Ámbitus ház — Sáfrány út 38/a, Egerszalók", key="ln_adr_home"):
            st.session_state.map_center = [lat_domu, lng_domu]
            st.session_state.map_zoom = 16
            st.session_state.map_refresh_key += 1
            st.rerun()
        
        st.markdown("### 📌 Spis atrakcji (hiperlinki):")
        for p in punkty:
            if st.button(f"🌐 #{p['id']} - {p['name']} ({p['category']})", key=f"ln_map_{p['id']}", help="Kliknij, aby wycentrować mapę"):
                st.session_state.map_center = [p["lat"], p["lng"]]
                st.session_state.map_zoom = 16
                st.session_state.map_refresh_key += 1
                st.rerun()

# ==========================================
# 2. WIDOK: WYDATKI
# ==========================================
if "💰 Wydatki" in t_dict:
    with t_dict["💰 Wydatki"]:
        st.subheader("💰 Wydatki Stada")
        try: lista_w = supabase.table("costs").select("*").eq("deleted", False).order("created_at", desc=True).execute().data or []
        except:
            try: lista_w = supabase.table("Costs").select("*").eq("deleted", False).order("created_at", desc=True).execute().data or []
            except: lista_w = []

        with st.expander("➕ Dodaj nowy wydatek"):
            with st.form("form_koszt"):
                nazwa_kosztu = st.text_input("Za co?")
                kwota_kosztu = st.number_input("Ile?", min_value=0.0, step=5.0)
                waluta_kosztu = st.selectbox("Waluta:", ["HUF", "PLN", "EUR"])
                dla_kogo = st.selectbox("Dla kogo (Ekipa):", ["Całe Stado", "Bobry", "Sileziny", "Robaki", "Pakuły"])
                komentarz_kosztu = st.text_input("Komentarz:", value="")
                is_private = st.checkbox("🔒 Prywatny wydatek (widoczny tylko dla pary)")
                
                if st.form_submit_button("Zapisz wydatek") and nazwa_kosztu and kwota_kosztu > 0:
                    try: supabase.table("costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_kosztu, "currency": waluta_kosztu, "cost_name": nazwa_kosztu, "borrower": dla_kogo, "is_private": is_private, "comment": komentarz_kosztu}).execute()
                    except: supabase.table("Costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_kosztu, "currency": waluta_kosztu, "cost_name": nazwa_kosztu, "borrower": dla_kogo, "is_private": is_private, "comment": komentarz_kosztu}).execute()
                    st.rerun()

        for w in lista_w:
            if w.get("is_private"):
                dostepni_userzy = [w["paid_by"], MALZENSTWA.get(w["paid_by"])]
                if user_aktualny not in dostepni_userzy: continue
            prywatna_klodka = "🔒 [Prywatne] " if w.get("is_private") else ""
            st.markdown(f"**{prywatna_klodka}{w['paid_by']}** ➔ *{w['cost_name']}* (`{w['amount']:.2f} {w['currency']}` dla {w['borrower']})")

# ==========================================
# 3. WIDOK: PORTFEL (WSPÓLNY DLA CAŁEGO TEAMU)
# ==========================================
if "🏦 Portfel" in t_dict:
    with t_dict["🏦 Portfel"]:
        st.markdown(f"### 🏦 Twój Team: **{team_aktualny}**")
        
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

            # SCENARIUSZ 1: Ktoś dodał koszt dla CAŁEGO STADA
            if dla_kogo == "Całe Stado":
                koszt_na_glowe = kwota / 15
                
                # ZMIANA: Sprawdzamy czy płacił nasz TEAM (wspólny widok dla pary)
                if team_placacy == team_aktualny:
                    for t_name, l_osob in LICZBA_OSOB_W_EKIPIE.items():
                        if t_name == "Całe Stado" or t_name == team_aktualny: continue
                        szczegol_kwota = l_osob * koszt_na_glowe
                        ktos_zalega.append(f"🧾 {t_name} ➔ **{szczegol_kwota:,.2f} {wal}**")
                        razem_pln += (szczegol_kwota * kurs_do_pln)
                
                else:
                    ile_osob_u_nas = LICZBA_OSOB_W_EKIPIE.get(team_aktualny, 4)
                    szczegol_kwota = ile_osob_u_nas * koszt_na_glowe
                    mamy_oddac.append(f"🧾 {team_placacy} ➔ **{szczegol_kwota:,.2f} {wal}**")
                    razem_pln -= (szczegol_kwota * Player_kurs_do_pln if 'Player_kurs_do_pln' in locals() else szczegol_kwota * kurs_do_pln)

            # SCENARIUSZ 2: Koszt skierowany na konkretną rodzinę
            elif dla_kogo == team_aktualny and team_placacy != team_aktualny:
                mamy_oddac.append(f"🧾 {team_placacy} ➔ **{kwota:,.2f} {wal}**")
                razem_pln -= (kwota * kurs_do_pln)
                
            elif dla_kogo != team_aktualny and team_placacy == team_aktualny:
                ktos_zalega.append(f"🧾 {dla_kogo} ➔ **{kwota:,.2f} {wal}**")
                razem_pln += (kwota * kurs_do_pln)

        st.markdown("### 🔴 Mamy oddać:")
        if mamy_oddac:
            for item in mamy_oddac: st.markdown(item)
        else: st.write("*Czysto! Nie macie zaległości.*")

        st.markdown("### 🟢 Ktoś nam zalega:")
        if ktos_zalega:
            for item in ktos_zalega: st.markdown(item)
        else: st.write("*Brak zaległości ze strony innych rodzin.*")

        st.markdown("---")
        if razem_pln >= 0:
            st.metric(label="📊 Bilans końcowy (RAZEM)", value=f"+ {razem_pln:,.2f} PLN")
        else:
            st.metric(label="📊 Bilans końcowy (RAZEM)", value=f"- {abs(razem_pln):,.2f} PLN")

# ==========================================
# 4. WIDOK: ZAKUPY
# ==========================================
if "🛒 Zakupy" in t_dict:
    with t_dict["🛒 Zakupy"]:
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
            wybrana_lista_id = st.selectbox("Wybierz listę do wyświetlenia:", list(opcje_list.keys()), format_func=lambda x: opcje_list[x])

        if wybrana_lista_id:
            klucz_blokady = f"lista_zamknieta_{wybrana_lista_id}"
            czy_edytowalna = not st.session_state.get(klucz_blokady, False)
            
            if czy_edytowalna:
                with st.form("dodaj_prod_form", clear_on_submit=True):
                    nowy_prod = st.text_input("Dodaj produkt:")
                    if st.form_submit_button("Dodaj") and nowy_prod:
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
                st.success("🛒 **Wszystkie produkty zebrane! Wprowadź paragon z zakupów:**")
                with st.form("form_rozlicz_zakupy"):
                    kwota_z = st.number_input("Finalna kwota z paragonu:", min_value=0.0, step=10.0)
                    waluta_z = st.selectbox("Waluta paragonu:", ["HUF", "PLN", "EUR"])
                    rozlicz_z = st.selectbox("Z kim rozliczyć te zakupy:", ["Całe Stado", "Bobry", "Sileziny", "Robaki", "Pakuły"])
                    
                    if st.form_submit_button("👍 Zamknij listę i zapisz wydatek"):
                        if kwota_z > 0:
                            try: supabase.table("costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_z, "currency": waluta_z, "cost_name": f"Zakupy z Listy #{wybrana_lista_id}", "borrower": rozlicz_z, "is_private": False}).execute()
                            except: supabase.table("Costs").insert({"created_by": id_aktualny, "paid_by": user_aktualny, "amount": kwota_z, "currency": waluta_z, "cost_name": f"Zakupy z Listy #{wybrana_lista_id}", "borrower": rozlicz_z, "is_private": False}).execute()
                            
                            st.session_state[klucz_blokady] = True
                            st.success("Wydatek pomyślnie dodany do bazy, lista zamknięta!")
                            st.rerun()
            
            if not czy_edytowalna:
                st.info("🔒 Ta lista zakupów została rozliczona i zamknięta.")

# ==========================================
# 5. WIDOK: PŁACIMY RAZEM
# ==========================================
if "📊 Płacimy Razem" in t_dict:
    with t_dict["📊 Płacimy Razem"]:
        st.subheader("📊 Płacimy Razem - Kalkulator Atrakcji")
        waluta_atr = st.selectbox("Waluta biletów:", ["HUF", "PLN", "EUR"], key="wal_atr_razem")
        c_normalny = st.number_input("Cena biletu normalnego:", min_value=0.0, step=100.0, key="c_norm_r")
        c_ulgowy = st.number_input("Cena biletu ulgowego (wpisz 0 jeśli brak):", min_value=0.0, step=100.0, key="c_ulg_r")

        if c_normalny > 0:
            if c_ulgowy == 0:
                koszt_calkowity = 15 * c_normalny
                b_koszt, p_koszt, r_koszt, s_koszt = 3 * c_normalny, 4 * c_normalny, 4 * c_normalny, 4 * c_normalny
            else:
                koszt_calkowity = 8 * c_normalny + 7 * c_ulgowy
                b_koszt = 2 * c_normalny + 1 * c_ulgowy
                p_koszt, r_koszt, s_koszt = 2 * c_normalny + 2 * c_ulgowy, 2 * c_normalny + 2 * c_ulgowy, 2 * c_normalny + 2 * c_ulgowy

            st.markdown(f"### 💰 Łącznie: **{koszt_calkowity:,.2f} {waluta_atr}**".replace(",", " "))
            st.write(f"🦫 **Bobry (3 os.):** {b_koszt:,.2f} {waluta_atr}".replace(",", " "))
            st.write(f"🐗 **Pakuły (4 os.):** {p_koszt:,.2f} {waluta_atr}".replace(",", " "))
            st.write(f"🪱 **Robaki (4 os.):** {r_koszt:,.2f} {waluta_atr}".replace(",", " "))
            st.write(f"⛰️ **Sileziny (4 os.):** {s_koszt:,.2f} {waluta_atr}".replace(",", " "))

# ==========================================
# 6. WIDOK: KANTOR
# ==========================================
if "💱 Kantor" in t_dict:
    with t_dict["💱 Kantor"]:
        st.subheader("💱 Przelicznik Walut w Kantorze")
        
        c1, c2, c3 = st.columns(3)
        with c1: kwota_wejsciowa = st.number_input("Wpisz kwotę:", min_value=0.0, value=100.0, step=10.0, key="k_wejsc")
        with c2: val_z = st.selectbox("Z waluty:", ["PLN", "HUF", "EUR"], key="k_z_w")
        with c3: val_do = st.selectbox("Na walutę:", ["PLN", "HUF", "EUR"], key="k_do_w", index=1)
        
        if val_z != val_do:
            kurs_oficjalny = baza_kursow_global.get((val_z, val_do), 1.0)
            st.write(f"📊 Średni kurs rynkowy: **1 {val_z} = {kurs_oficjalny:.4f} {val_do}**")
            
            uzyj_wlasnego = st.checkbox(f"Chcę użyć własnego kursu wymiany kantoru ({val_z} ➔ {val_do})")
            kurs_koncowy = st.number_input(f"Wpisz ile {val_do} za 1 {val_z}:", min_value=0.0, value=float(kurs_oficjalny), format="%.4f") if uzyj_wlasnego else kurs_oficjalny
            
            baza_kursow_global[(val_z, val_do)] = kurs_koncowy
            baza_kursow_global[(val_do, val_z)] = 1.0 / kurs_koncowy
            
            st.metric(label="Wynik po przeliczeniu", value=f"{kwota_wejsciowa * kurs_koncowy:,.2f} {val_do}".replace(",", " "))

# ==========================================
# 7. WIDOK: ROZGRYWKI
# ==========================================
if "🎲 Rozgrywki" in t_dict:
    with t_dict["🎲 Rozgrywki"]:
        st.subheader("🎲 Turnieje i Gry Stada")
        
        gra_wybrana = st.selectbox("Wybierz grę:", ["Blocus", "Tysiąc", "Remik", "Inne"], key="wyb_gre_m")
        gracze_m = st.multiselect("Wybierz aktywnych graczy z ekipy:", list(HASLA.keys()))
        
        if st.button("🎬 Rozpocznij nową partię") and gracze_m:
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
if "🧳 Pakowanie" in t_dict:
    with t_dict["🧳 Pakowanie"]:
        st.subheader("🧳 Pakowanie Stada")
        with st.form("dodaj_pakowanie"):
            rzecz = st.text_input("Co zabierasz dla ekipy?")
            if st.form_submit_button("Zgłoś") and rzecz:
                try: supabase.table("packing").insert({"created_by": id_aktualny, "comment": f"{user_aktualny} bierze: {rzecz}"}).execute()
                except: supabase.table("Packing").insert({"created_by": id_aktualny, "comment": f"{user_aktualny} bierze: {rzecz}"}).execute()
                st.rerun()
        try:
            paczki = supabase.table("packing").select("*").order("created_at", desc=True).execute().data or []
            for p in paczki: st.write(p["comment"])
        except: pass

if "💬 Forum" in t_dict:
    with t_dict["💬 Forum"]:
        st.subheader("💬 Forum Stada")
        with st.form("wpis_forum"):
            t_wpisu = st.text_input("Napisz ogłoszenie:")
            if st.form_submit_button("Wyślij") and t_wpisu:
                try: supabase.table("forum").insert({"created_by": id_aktualny, "comment": t_wpisu, "created_at": datetime.now(timezone.utc).isoformat()}).execute()
                except: supabase.table("Forum").insert({"created_by": id_aktualny, "comment": t_wpisu, "created_at": datetime.now(timezone.utc).isoformat()}).execute()
                st.rerun()
        try:
            wpisy = supabase.table("forum").select("comment, Users(login)").order("created_at", desc=True).execute().data or []
            for f in wpisy: st.info(f"{f.get('Users', {}).get('login', 'Anonim')}: {f['comment']}")
        except: pass

# ==========================================
# ⚙️ STOPKA SYSTEMOWA
# ==========================================
st.markdown("---")
col_ft1, col_ft2 = st.columns(2)
with col_ft1:
    st.markdown("<small>© Copyright JBP — [GitHub Repository](https://github.com)</small>", unsafe_allow_html=True)
with col_ft2:
    st.markdown("<p style='text-align: right; margin:0px;'><small>📅 Last edit: <b>07.07.2026 r.</b> | <a href='https://mkysisoznxgssakcegbn.supabase.co/storage/v1/object/sign/assets/Dokumentacja.TXT?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yNjUxNmQ5Zi1mOTMwLTQwN2QtODJmNi00YjU3MGVhZTJhMGYiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJhc3NldHMvRG9rdW1lbnRhY2phLlRYVCIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODM0NTgzNzQsImV4cCI6MTgxNDk5NDM3NH0.zk2NhWJtsgLwgmDSsoaWgeQ4LAIkvUYUKOB8mXiiYlc'>📄 Dokumentacja (TXT)</a></small></p>", unsafe_allow_html=True)