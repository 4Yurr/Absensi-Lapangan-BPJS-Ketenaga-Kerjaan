'use strict';

/**
 * app.js — Main Application Controller
 * =====================================
 * Coordinates all modules:
 *   - LocationModule  (GPS & Reverse Geocoding)
 *   - MapModule       (Leaflet read-only map)
 *   - CameraModule    (Photo capture & compression)
 *   - Data Peserta    (NIM lookup dari database peserta via GAS backend)
 *   - Sesi Banner     (Status sesi Pagi/Sore berdasarkan waktu server WIB)
 *   - Form validation & submit flow
 *   - HTTP POST to Google Apps Script backend
 */

/* ================================================================
   CONFIGURATION — Edit before deploying
   ================================================================ */
const GAS_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzPyJB7PGyyZ0EsYgOnJuuYrDUZUtOOXYhd_lfnAur_xZGtrpGPCo8w_sSLvcv0JlYTlA/exec';

/* ================================================================
   APPLICATION STATE
   ================================================================ */
const AppState = {
  /* ─── Location State ─── */
  lat:           null,    // Latitude (number)
  lon:           null,    // Longitude (number)
  address:       null,    // Reverse geocoded address (string)

  /* ─── Photo State ─── */
  photoBase64:   null,    // Base64 JPEG string
  photoFileName: null,    // Original file name
  isSubmitting:  false,   // Guard against double-submit

  /* ─── Peserta State (from database peserta) ─── */
  pesertaList:   [],      // [{nim, nama}, ...] loaded from server
  pesertaLoaded: false,   // True after successful fetch
  selectedNIM:   null,    // Currently validated NIM
  selectedNama:  null,    // Name from master data (read-only)

  /* ─── Session State (from server WIB time) ─── */
  serverSesi:    null,    // 'PAGI' | 'SORE' | null
  serverSesiValid: false, // True if currently in a valid session window
};

/* ================================================================
   DOM ELEMENTS
   ================================================================ */
const El = {
  // Session Banner
  sessionBanner:      document.getElementById('sessionBanner'),
  sessionIcon:        document.getElementById('sessionIcon'),
  sessionLabel:       document.getElementById('sessionLabel'),
  sessionSublabel:    document.getElementById('sessionSublabel'),
  sessionTimeBadge:   document.getElementById('sessionTimeBadge'),
  sessionTimeDisplay: document.getElementById('sessionTimeDisplay'),

  // Identity
  inputNIM:       document.getElementById('inputNIM'),
  inputNama:      document.getElementById('inputNama'),
  nimList:        document.getElementById('nimList'),
  nimHelp:        document.getElementById('nimHelp'),

  // Location
  btnGetLocation:     document.getElementById('btnGetLocation'),
  btnGetLocationText: document.getElementById('btnGetLocationText'),
  locationStatus:     document.getElementById('locationStatus'),
  mapWrapper:         document.getElementById('mapWrapper'),
  addressCard:        document.getElementById('addressCard'),
  addressText:        document.getElementById('addressText'),
  latDisplay:         document.getElementById('latDisplay'),
  lonDisplay:         document.getElementById('lonDisplay'),

  // Photo
  photoInput:          document.getElementById('photoInput'),
  btnTakePhoto:        document.getElementById('btnTakePhoto'),
  btnTakePhotoText:    document.getElementById('btnTakePhotoText'),
  photoPreviewWrapper: document.getElementById('photoPreviewWrapper'),
  photoPreview:        document.getElementById('photoPreview'),
  btnChangePhoto:      document.getElementById('btnChangePhoto'),

  // Submit
  btnSubmit:      document.getElementById('btnSubmit'),
  btnSubmitText:  document.getElementById('btnSubmitText'),

  // Modal
  modalOverlay:   document.getElementById('modalOverlay'),
  modalCard:      document.querySelector('.modal-card'),
  modalIcon:      document.getElementById('modalIcon'),
  modalTitle:     document.getElementById('modalTitle'),
  modalMessage:   document.getElementById('modalMessage'),
  modalDetail:    document.getElementById('modalDetail'),
  modalBtn:       document.getElementById('modalBtn'),

  // Loading Overlay
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText:    document.getElementById('loadingText'),
};

/* ================================================================
   HELPERS
   ================================================================ */
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

/** Set the location status message with a visual type. */
function setLocationStatus(message, type = 'info') {
  if (type === 'success') {
    El.locationStatus.innerHTML = '<span class="status-ok-badge" aria-hidden="true">✓</span>';
  } else if (type === 'error') {
    El.locationStatus.innerHTML = `<span class="status-err-badge" aria-hidden="true">✕</span> <span>${message}</span>`;
  } else {
    El.locationStatus.innerHTML = `<span>${message}</span>`;
  }
  El.locationStatus.className = `location-status status-${type}`;
  show(El.locationStatus);
}

/** Internal state update function (kept for event handler compatibility) */
function updateReadiness() {
  // Validation is dynamically checked on submit click
}

/* ================================================================
   SESSION BANNER — Tampilkan status sesi berdasarkan waktu server WIB
   ================================================================ */

/**
 * Query waktu server WIB, perbarui session banner, dan simpan ke AppState.
 * Dilakukan saat init. Jika gagal, fallback ke estimasi waktu browser.
 */
async function loadServerSession() {
  try {
    const url = GAS_ENDPOINT + '?action=getServerTime';
    const response = await fetch(url, { method: 'GET', mode: 'cors' });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { throw new Error('Respons server tidak valid.'); }

    if (result.status === 'success') {
      AppState.serverSesi      = result.sesi      || null;
      AppState.serverSesiValid = result.sesiValid  || false;

      updateSessionBanner({
        valid:    result.sesiValid,
        sesi:     result.sesi,
        time:     result.time,     // "HH:mm:ss"
        message:  result.message,
      });
    } else {
      throw new Error(result.message || 'Gagal mendapatkan waktu server.');
    }

  } catch (err) {
    console.warn('[App] loadServerSession error:', err.message);
    // Fallback: estimasi dari browser (hanya untuk UI, bukan validasi)
    const wibTime = getWIBTime();
    const fallbackSesi = estimateSesiFallback(wibTime.hour);
    AppState.serverSesi      = fallbackSesi.sesi;
    AppState.serverSesiValid = fallbackSesi.valid;

    updateSessionBanner({
      valid:   fallbackSesi.valid,
      sesi:    fallbackSesi.sesi,
      time:    wibTime.timeStr,
      message: fallbackSesi.message + ' (estimasi browser — validasi tetap dilakukan server)',
    });
  }
}

/**
 * Perbarui tampilan session banner berdasarkan status sesi.
 * @param {{ valid: boolean, sesi: string|null, time: string, message: string }} info
 */
function updateSessionBanner({ valid, sesi, time, message }) {
  // Perbarui jam tampilan
  if (El.sessionTimeDisplay && time) {
    El.sessionTimeDisplay.textContent = time.substring(0, 5); // HH:mm
  }

  if (valid && sesi === 'PAGI') {
    El.sessionBanner.className = 'session-banner session-pagi';
    El.sessionLabel.textContent = 'ABSENSI PAGI';
    El.sessionSublabel.textContent = 'Batas waktu: sebelum 09:00 WIB';
    El.sessionIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>`;

  } else if (valid && sesi === 'SORE') {
    El.sessionBanner.className = 'session-banner session-sore';
    El.sessionLabel.textContent = 'ABSENSI SORE';
    El.sessionSublabel.textContent = 'Absensi sore dibuka mulai 16:00 WIB';
    El.sessionIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 18a5 5 0 0 0-10 0"/>
        <line x1="12" y1="2" x2="12" y2="9"/>
        <line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/>
        <line x1="1" y1="18" x2="3" y2="18"/>
        <line x1="21" y1="18" x2="23" y2="18"/>
        <line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/>
        <line x1="23" y1="22" x2="1" y2="22"/>
        <polyline points="8 6 12 2 16 6"/>
      </svg>`;

  } else {
    // Di luar jam absensi
    El.sessionBanner.className = 'session-banner session-closed';
    El.sessionLabel.textContent = 'DI LUAR JAM ABSENSI';
    El.sessionSublabel.textContent = message || 'Absensi pagi: sebelum 09:00 WIB | Absensi sore: mulai 16:00 WIB';
    El.sessionIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>`;
  }
}

/**
 * Hitung estimasi WIB dari browser untuk fallback UI.
 * Bukan untuk validasi — hanya sebagai petunjuk tampilan.
 */
function getWIBTime() {
  const now = new Date();
  const wibFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = wibFormatter.formatToParts(now);
  const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const s = parseInt(parts.find(p => p.type === 'second').value, 10);
  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return { hour: h, minute: m, second: s, timeStr };
}

/**
 * Estimasi sesi berdasarkan jam WIB (untuk fallback browser).
 */
function estimateSesiFallback(hour) {
  if (hour < 9) {
    return { valid: true,  sesi: 'PAGI', message: 'Sesi Pagi — sebelum 09:00 WIB' };
  }
  if (hour < 16) {
    return { valid: false, sesi: null,   message: 'Di luar jam absensi' };
  }
  return { valid: true, sesi: 'SORE', message: 'Sesi Sore — mulai 16:00 WIB' };
}

/* ================================================================
   DATA PESERTA — Load on page open
   ================================================================ */

/**
 * Fetch peserta list dari GAS backend (database peserta baru) saat halaman dibuka.
 * Mengisi NIM datalist untuk autocomplete.
 */
async function loadPeserta() {
  try {
    const url = GAS_ENDPOINT + '?action=getPeserta';
    const response = await fetch(url, { method: 'GET', mode: 'cors' });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      if (text.includes('signin') || text.includes('accounts.google.com') || text.startsWith('<!doctype')) {
        throw new Error('Web App memerlukan izin "Anyone". Pastikan deploy dengan akses "Anyone".');
      }
      throw new Error('Respons server bukan JSON valid.');
    }

    if (result.status === 'success' && Array.isArray(result.data)) {
      AppState.pesertaList   = result.data;
      AppState.pesertaLoaded = true;

      // Populate datalist dengan opsi NIM
      El.nimList.innerHTML = '';
      result.data.forEach((p) => {
        const option = document.createElement('option');
        option.value = p.nim;
        option.label = p.nama;
        El.nimList.appendChild(option);
      });

      clearNimHint();
      console.info(`[App] ${result.data.length} peserta dimuat dari database peserta.`);
    } else {
      console.warn('[App] getPeserta non-success:', result.message || result);
      setNimHint(result.message || 'Gagal memuat data peserta.', 'error');
    }
  } catch (err) {
    console.error('[App] Failed to load peserta:', err);
    setNimHint(err.message || 'Tidak dapat memuat data peserta. Periksa koneksi internet.', 'error');
  }
}

/**
 * Set hint text di bawah input NIM.
 */
function setNimHint(text, type) {
  El.nimHelp.textContent = text;
  El.nimHelp.className   = `form-hint hint-${type}`;
  show(El.nimHelp);
}

function clearNimHint() {
  El.nimHelp.textContent = '';
  hide(El.nimHelp);
}

/* ================================================================
   NIM INPUT — Lookup dari daftar peserta
   ================================================================ */

let _nimDebounce = null;

El.inputNIM.addEventListener('input', () => {
  clearTimeout(_nimDebounce);

  const nimValue = El.inputNIM.value.trim();

  // Bersihkan selection sebelumnya
  AppState.selectedNIM  = null;
  AppState.selectedNama = null;
  El.inputNama.value     = '';
  El.inputNama.classList.remove('input-filled');
  El.inputNIM.classList.remove('input-filled', 'input-error');

  if (nimValue === '') {
    clearNimHint();
    updateReadiness();
    return;
  }

  // Debounce 300ms setelah user berhenti mengetik
  _nimDebounce = setTimeout(() => { lookupNIM(nimValue); }, 300);
});

// Trigger lookup juga saat user memilih dari datalist
El.inputNIM.addEventListener('change', () => {
  const nimValue = El.inputNIM.value.trim();
  if (nimValue !== '') {
    clearTimeout(_nimDebounce);
    lookupNIM(nimValue);
  }
});

/**
 * Cari NIM di pesertaList (pencarian lokal client-side).
 */
function lookupNIM(nim) {
  if (!AppState.pesertaLoaded) {
    setNimHint('Data peserta belum dimuat. Mohon tunggu...', 'loading');
    updateReadiness();
    return;
  }

  const match = AppState.pesertaList.find((p) => p.nim === nim);

  if (match) {
    AppState.selectedNIM  = match.nim;
    AppState.selectedNama = match.nama;

    El.inputNama.value = match.nama;
    El.inputNama.classList.add('input-filled');
    El.inputNIM.classList.add('input-filled');
    El.inputNIM.classList.remove('input-error');

    setNimHint(`Peserta terverifikasi: ${match.nama}`, 'success');
  } else {
    AppState.selectedNIM  = null;
    AppState.selectedNama = null;
    El.inputNama.value     = '';
    El.inputNama.classList.remove('input-filled');
    El.inputNIM.classList.add('input-error');
    El.inputNIM.classList.remove('input-filled');

    setNimHint('NIM tidak terdaftar dalam data peserta.', 'error');
  }

  updateReadiness();
}

/* ================================================================
   LOCATION FLOW
   ================================================================ */
El.btnGetLocation.addEventListener('click', handleGetLocation);

async function handleGetLocation() {
  El.btnGetLocation.disabled = true;
  El.btnGetLocation.classList.add('btn-loading');
  El.btnGetLocationText.textContent = 'Mendeteksi lokasi...';
  setLocationStatus('Membaca koordinat GPS perangkat Anda...', 'info');

  AppState.lat     = null;
  AppState.lon     = null;
  AppState.address = null;
  hide(El.mapWrapper);
  hide(El.addressCard);
  updateReadiness();

  try {
    /* ─── Step 1: Koordinat GPS ─── */
    const { lat, lon } = await LocationModule.requestLocation();
    AppState.lat = lat;
    AppState.lon = lon;

    El.latDisplay.textContent = `Lat: ${lat.toFixed(6)}`;
    El.lonDisplay.textContent = `Long: ${lon.toFixed(6)}`;

    show(El.mapWrapper);
    MapModule.initMap(lat, lon);
    MapModule.invalidateSize();

    El.addressText.textContent = 'Mendeteksi nama lokasi...';
    show(El.addressCard);

    setLocationStatus('Koordinat GPS berhasil terdeteksi.', 'success');
    El.btnGetLocationText.textContent = 'Perbarui Lokasi';
    updateReadiness();

    /* ─── Step 2: Reverse Geocoding (non-blocking) ─── */
    const address    = await LocationModule.reverseGeocode(lat, lon);
    AppState.address = address;
    El.addressText.textContent = address;

  } catch (err) {
    AppState.lat     = null;
    AppState.lon     = null;
    AppState.address = null;
    hide(El.mapWrapper);
    hide(El.addressCard);
    setLocationStatus(err.message, 'error');
    El.btnGetLocationText.textContent = 'Coba Lagi';

  } finally {
    El.btnGetLocation.disabled = false;
    El.btnGetLocation.classList.remove('btn-loading');
    updateReadiness();
  }
}

/* ================================================================
   PHOTO FLOW — Camera only (no gallery)
   ================================================================ */
El.btnTakePhoto.addEventListener('click', () => El.photoInput.click());
El.btnChangePhoto.addEventListener('click', () => El.photoInput.click());

El.photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  El.btnTakePhoto.disabled = true;
  El.btnTakePhoto.classList.add('btn-loading');

  CameraModule.processFile(
    file,
    /* onSuccess */
    (base64) => {
      AppState.photoBase64   = base64;
      AppState.photoFileName = CameraModule.getFileName();

      El.photoPreview.src = base64;
      hide(El.btnTakePhoto);
      show(El.photoPreviewWrapper);

      El.btnTakePhoto.disabled = false;
      El.btnTakePhoto.classList.remove('btn-loading');
      updateReadiness();
    },
    /* onError */
    (errMsg) => {
      AppState.photoBase64   = null;
      AppState.photoFileName = null;
      CameraModule.reset();

      El.btnTakePhoto.disabled = false;
      El.btnTakePhoto.classList.remove('btn-loading');

      showModal('error', 'Gagal Memuat Foto', errMsg);
      updateReadiness();
    }
  );

  e.target.value = '';
});

/* ================================================================
   SUBMIT FLOW
   ================================================================ */
El.btnSubmit.addEventListener('click', handleSubmit);

async function handleSubmit() {
  if (AppState.isSubmitting) return;

  const rawNim = El.inputNIM.value.trim();
  const nim    = AppState.selectedNIM;
  const nama   = AppState.selectedNama;
  const latOk  = AppState.lat !== null && AppState.lon !== null;
  const fotoOk = AppState.photoBase64 !== null;

  /* ─── Client-side validation ─── */
  const missing = [];

  if (!rawNim) {
    missing.push('Nomor NIM wajib diisi.');
  } else if (!nim || !nama) {
    missing.push('NIM tidak terdaftar. Silakan periksa kembali NIM Anda.');
  }

  if (!latOk) {
    missing.push('Lokasi GPS belum diambil.');
  }

  if (!fotoOk) {
    missing.push('Foto kegiatan belum diambil.');
  }

  if (missing.length > 0) {
    const msg = missing.length === 1
      ? missing[0]
      : 'Lengkapi data berikut sebelum mengirim:\n' + missing.map(m => `• ${m}`).join('\n');
    showModal('error', 'Data Belum Lengkap', msg);
    return;
  }

  /* ─── Lock UI ─── */
  AppState.isSubmitting = true;
  El.btnSubmit.disabled = true;
  El.btnSubmitText.textContent = 'Mengirim Data...';
  show(El.loadingOverlay);
  El.loadingText.textContent = 'Mengunggah foto ke Google Drive...';

  /* ─── Build Payload ─── */
  const payload = {
    nim,
    nama,
    latitude:     AppState.lat,
    longitude:    AppState.lon,
    lokasi:       AppState.address || `Koordinat: ${AppState.lat}, ${AppState.lon}`,
    fotoBase64:   AppState.photoBase64,
    fotoFileName: AppState.photoFileName || 'foto_kegiatan.jpg',
  };

  try {
    El.loadingText.textContent = 'Mencatat data absensi...';

    const response = await fetch(GAS_ENDPOINT, {
      method:  'POST',
      mode:    'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server error: HTTP ${response.status} ${response.statusText}`);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Server mengembalikan respons yang tidak valid. Silakan coba lagi.');
    }

    /* ─── Handle GAS Response ─── */
    hide(El.loadingOverlay);

    if (result.status === 'success') {
      const d = result.data || {};
      const sesiStr = d.sesi ? d.sesi.charAt(0) + d.sesi.slice(1).toLowerCase() : '';

      const detail = [
        d.nim     ? `NIM     : ${d.nim}`              : '',
        d.nama    ? `Nama    : ${d.nama}`              : '',
        d.tanggal ? `Tanggal : ${d.tanggal}`           : '',
        sesiStr   ? `Sesi    : ${sesiStr}`             : '',
        d.jam     ? `Jam     : ${d.jam} WIB`           : '',
        d.lokasi  ? `Lokasi  : ${d.lokasi}`            : '',
      ].filter(Boolean).join('\n');

      showModal('success', 'Absensi Berhasil!', 'Data kehadiran Anda telah berhasil dicatat.', detail);

      // Perbarui session banner setelah sukses
      loadServerSession();
      resetAfterSuccess();

    } else if (result.status === 'duplicate') {
      // Tampilkan pesan dengan nama sesi yang spesifik
      const sesiName = result.sesi
        ? result.sesi.charAt(0) + result.sesi.slice(1).toLowerCase()
        : '';
      const dupMsg = result.message ||
        (sesiName
          ? `Anda sudah melakukan absensi ${sesiName} hari ini.`
          : 'Anda sudah melakukan absensi pada sesi ini hari ini.');
      showModal('error', 'Absensi Sudah Tercatat', dupMsg);

    } else if (result.status === 'time_invalid') {
      // Absensi di luar jam yang diperbolehkan
      showModal('error', 'Di Luar Jam Absensi', result.message || 'Waktu absensi tidak valid.');
      // Perbarui session banner
      loadServerSession();

    } else if (result.status === 'error') {
      showModal('error', 'Absensi Ditolak', result.message || 'Terjadi kesalahan pada server.');

    } else {
      showModal('error', 'Respons Tidak Diketahui', 'Server mengembalikan status tidak diketahui. Hubungi administrator.');
    }

  } catch (err) {
    hide(El.loadingOverlay);
    console.error('[App] Submit error:', err);

    let errMsg = 'Terjadi kesalahan saat mengirim data. Periksa koneksi internet Anda dan coba lagi.';
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Load failed')) {
      errMsg = 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.';
    } else if (err.message.startsWith('Server error:')) {
      errMsg = `${err.message}. Hubungi administrator jika masalah berlanjut.`;
    } else if (err.message.includes('tidak valid')) {
      errMsg = err.message;
    }

    showModal('error', 'Gagal Mengirim Data', errMsg);

  } finally {
    AppState.isSubmitting = false;
    El.btnSubmit.disabled = false;
    El.btnSubmitText.textContent = 'Kirim Absensi';
    updateReadiness();
  }
}

/* ================================================================
   MODAL
   ================================================================ */
function showModal(type, title, message, detail = '') {
  const isSuccess = (type === 'success');

  if (isSuccess) {
    El.modalIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>`;
  } else {
    El.modalIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`;
  }

  El.modalIcon.className      = `modal-icon modal-icon-${type}`;
  El.modalTitle.textContent   = title;
  El.modalMessage.textContent = message;
  El.modalCard.className      = `modal-card modal-${type}`;

  if (detail) {
    El.modalDetail.textContent = detail;
    show(El.modalDetail);
  } else {
    hide(El.modalDetail);
  }

  show(El.modalOverlay);
}

El.modalBtn.addEventListener('click', closeModal);
El.modalOverlay.addEventListener('click', (e) => {
  if (e.target === El.modalOverlay) closeModal();
});

function closeModal() {
  hide(El.modalOverlay);
}

/* ================================================================
   RESET FORM AFTER SUCCESS
   ================================================================ */
function resetAfterSuccess() {
  // Reset identity
  AppState.selectedNIM  = null;
  AppState.selectedNama = null;
  El.inputNIM.value      = '';
  El.inputNama.value     = '';
  El.inputNIM.classList.remove('input-filled', 'input-error');
  El.inputNama.classList.remove('input-filled');
  clearNimHint();

  // Reset location
  AppState.lat     = null;
  AppState.lon     = null;
  AppState.address = null;

  // Reset photo
  AppState.photoBase64   = null;
  AppState.photoFileName = null;
  CameraModule.reset();

  // Reset location UI
  El.btnGetLocationText.textContent = 'Ambil Lokasi Saya';
  El.latDisplay.textContent = 'Lat: —';
  El.lonDisplay.textContent = 'Long: —';
  hide(El.mapWrapper);
  hide(El.addressCard);
  hide(El.locationStatus);

  // Reset photo UI
  hide(El.photoPreviewWrapper);
  El.photoPreview.src = '';
  show(El.btnTakePhoto);
  El.btnTakePhotoText.textContent = 'Ambil Foto';

  updateReadiness();
}

/* ================================================================
   INIT
   ================================================================ */
(function init() {
  updateReadiness();

  // Load data peserta dan status sesi secara paralel
  Promise.all([
    loadPeserta(),
    loadServerSession(),
  ]).catch((err) => {
    console.error('[App] Init error:', err);
  });

  console.info('[App] Absensi BPJS Ketenagakerjaan initialized.');
})();
