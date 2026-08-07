'use strict';

/**
 * app.js — Main Application Controller
 * =====================================
 * Coordinates all modules:
 *   - LocationModule  (GPS & Reverse Geocoding)
 *   - MapModule       (Leaflet read-only map)
 *   - CameraModule    (Photo capture & compression)
 *   - Data Peserta    (NIM lookup from tab "Nama" via GAS backend)
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

  /* ─── Peserta State (from tab "Nama") ─── */
  pesertaList:   [],      // [{nim, nama, fakultas, prodi}, ...] loaded from sheet
  pesertaLoaded: false,   // True after successful fetch
  selectedNIM:   null,    // Currently validated NIM
  selectedNama:  null,    // Name from master data (read-only)
};

/* ================================================================
   DOM ELEMENTS
   ================================================================ */
const El = {
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

  // Submit & Readiness
  btnSubmit:      document.getElementById('btnSubmit'),
  btnSubmitIcon:  document.getElementById('btnSubmitIcon'),
  btnSubmitText:  document.getElementById('btnSubmitText'),
  submitHint:     document.getElementById('submitHint'),
  checkNIM:       document.getElementById('check-nim'),
  checkNama:      document.getElementById('check-nama'),
  checkLokasi:    document.getElementById('check-lokasi'),
  checkFoto:      document.getElementById('check-foto'),

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
  El.locationStatus.textContent = message;
  El.locationStatus.className   = `location-status status-${type}`;
  show(El.locationStatus);
}

/** Mark a readiness check item as ready or not. */
function setCheckReady(el, ready) {
  if (ready) {
    el.classList.add('ready');
  } else {
    el.classList.remove('ready');
  }
}

/** Evaluate all conditions and enable/disable Submit button. */
function updateReadiness() {
  const nimOk    = AppState.selectedNIM  !== null;
  const namaOk   = AppState.selectedNama !== null;
  const lokasiOk = AppState.lat !== null && AppState.lon !== null;
  const fotoOk   = AppState.photoBase64 !== null;

  setCheckReady(El.checkNIM,    nimOk);
  setCheckReady(El.checkNama,   namaOk);
  setCheckReady(El.checkLokasi, lokasiOk);
  setCheckReady(El.checkFoto,   fotoOk);

  El.btnSubmit.disabled = !(nimOk && namaOk && lokasiOk && fotoOk);
}

/* ================================================================
   DATA PESERTA — Load on page open (from tab "Nama")
   ================================================================ */

/**
 * Fetch peserta list from GAS backend (tab "Nama") at page load.
 * Populates the NIM datalist for autocomplete.
 */
async function loadPeserta() {
  try {
    const url = GAS_ENDPOINT + '?action=getPeserta';
    const response = await fetch(url, {
      method: 'GET',
      mode:   'cors',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      if (text.includes('signin') || text.includes('accounts.google.com') || text.startsWith('<!doctype')) {
        throw new Error('Web App Google Apps Script memerlukan izin "Anyone". Pastikan Web App di-deploy dengan akses "Anyone".');
      }
      throw new Error('Respons server bukan JSON valid.');
    }

    if (result.status === 'success' && Array.isArray(result.data)) {
      AppState.pesertaList   = result.data;
      AppState.pesertaLoaded = true;

      // Populate datalist with NIM options
      El.nimList.innerHTML = '';
      result.data.forEach((p) => {
        const option = document.createElement('option');
        option.value = p.nim;
        option.label = p.nama;
        El.nimList.appendChild(option);
      });

      clearNimHint();
      console.info(`[App] Loaded ${result.data.length} peserta from tab "Nama".`);
    } else {
      console.warn('[App] getPeserta returned non-success:', result.message || result);
      setNimHint(result.message || 'Gagal memuat data peserta.', 'error');
    }
  } catch (err) {
    console.error('[App] Failed to load peserta:', err);
    setNimHint(err.message || 'Tidak dapat memuat data peserta. Periksa koneksi internet.', 'error');
  }
}

/**
 * Set hint text below NIM input.
 * @param {string} text - Hint message
 * @param {string} type - 'loading' | 'success' | 'error'
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
   NIM INPUT — Lookup from tab "Nama"
   ================================================================ */

/** Debounce timer for NIM lookup */
let _nimDebounce = null;

El.inputNIM.addEventListener('input', () => {
  clearTimeout(_nimDebounce);

  const nimValue = El.inputNIM.value.trim();

  // Clear previous selection
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

  // Debounce: wait 300ms after user stops typing
  _nimDebounce = setTimeout(() => {
    lookupNIM(nimValue);
  }, 300);
});

// Also trigger lookup on change (when user selects from datalist)
El.inputNIM.addEventListener('change', () => {
  const nimValue = El.inputNIM.value.trim();
  if (nimValue !== '') {
    clearTimeout(_nimDebounce);
    lookupNIM(nimValue);
  }
});

/**
 * Look up NIM in pesertaList (client-side search from tab "Nama").
 * If pesertaList is loaded, performs instant local search.
 * @param {string} nim
 */
function lookupNIM(nim) {
  if (!AppState.pesertaLoaded) {
    setNimHint('Data peserta belum dimuat. Mohon tunggu...', 'loading');
    updateReadiness();
    return;
  }

  // Find match in peserta list
  const match = AppState.pesertaList.find(
    (p) => p.nim === nim
  );

  if (match) {
    // NIM found — fill name (read-only)
    AppState.selectedNIM  = match.nim;
    AppState.selectedNama = match.nama;

    El.inputNama.value = match.nama;
    El.inputNama.classList.add('input-filled');
    El.inputNIM.classList.add('input-filled');
    El.inputNIM.classList.remove('input-error');

    setNimHint(`Peserta terverifikasi: ${match.nama}`, 'success');
  } else {
    // NIM not found
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
  // UI: loading state
  El.btnGetLocation.disabled = true;
  El.btnGetLocation.classList.add('btn-loading');
  El.btnGetLocationText.textContent = 'Mendeteksi lokasi...';
  setLocationStatus('Membaca koordinat GPS perangkat Anda...', 'info');

  // Reset previous location state
  AppState.lat     = null;
  AppState.lon     = null;
  AppState.address = null;
  hide(El.mapWrapper);
  hide(El.addressCard);
  updateReadiness();

  try {
    /* ─── Step 1: Get GPS coordinates ─── */
    const { lat, lon } = await LocationModule.requestLocation();
    AppState.lat = lat;
    AppState.lon = lon;

    // Update UI with coordinates
    El.latDisplay.textContent = `Lat: ${lat.toFixed(6)}`;
    El.lonDisplay.textContent = `Long: ${lon.toFixed(6)}`;

    // Show map container then render map
    show(El.mapWrapper);
    MapModule.initMap(lat, lon);
    MapModule.invalidateSize();

    // Show address card with loading text
    El.addressText.textContent = 'Mendeteksi nama lokasi...';
    show(El.addressCard);

    setLocationStatus('Koordinat GPS berhasil terdeteksi.', 'success');
    El.btnGetLocationText.textContent = 'Perbarui Lokasi';
    updateReadiness();

    /* ─── Step 2: Reverse Geocoding (non-blocking for submit) ─── */
    const address = await LocationModule.reverseGeocode(lat, lon);
    AppState.address = address;
    El.addressText.textContent = address;

  } catch (err) {
    // GPS failed — clear state
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

  // UI: disable button while processing
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

  // Reset so same file can be reselected after "Ambil Ulang Foto"
  e.target.value = '';
});

/* ================================================================
   SUBMIT FLOW
   ================================================================ */
El.btnSubmit.addEventListener('click', handleSubmit);

async function handleSubmit() {
  if (AppState.isSubmitting) return;

  const nim  = AppState.selectedNIM;
  const nama = AppState.selectedNama;

  /* ─── Final client-side validation ─── */
  if (!nim || !nama) {
    showModal('error', 'Data Tidak Lengkap', 'NIM belum dipilih atau tidak valid. Pilih NIM dari daftar peserta.');
    return;
  }
  if (!AppState.lat || !AppState.lon) {
    showModal('error', 'Lokasi Belum Diambil', 'Tekan tombol "Ambil Lokasi Saya" dan tunggu hingga lokasi GPS berhasil terdeteksi.');
    return;
  }
  if (!AppState.photoBase64) {
    showModal('error', 'Foto Belum Diambil', 'Foto kegiatan wajib diambil langsung dengan kamera sebagai bukti kehadiran di lapangan.');
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
    latitude:      AppState.lat,
    longitude:     AppState.lon,
    lokasi:        AppState.address || `Koordinat: ${AppState.lat}, ${AppState.lon}`,
    fotoBase64:    AppState.photoBase64,
    fotoFileName:  AppState.photoFileName || 'foto_kegiatan.jpg',
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
      const detail = [
        d.nim     ? `NIM     : ${d.nim}`     : '',
        d.nama    ? `Nama    : ${d.nama}`    : '',
        d.tanggal ? `Tanggal : ${d.tanggal}` : '',
        d.jam     ? `Jam     : ${d.jam}`     : '',
        d.lokasi  ? `Lokasi  : ${d.lokasi}`  : '',
      ].filter(Boolean).join('\n');

      showModal('success', 'Absensi Berhasil!', 'Data kehadiran Anda telah berhasil dicatat.', detail);
      resetAfterSuccess();

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

  // Render clean SVG icon instead of raw emoji
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

  // Update modal card top-border color class
  El.modalCard.className = `modal-card modal-${type}`;

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
  loadPeserta();
  console.info('[App] Absensi Lapangan initialized. Loading data peserta dari tab "Nama"...');
})();
