'use strict';

/**
 * location.js — Geolocation & Reverse Geocoding Module
 * ======================================================
 * Handles:
 *   1. Reading GPS coordinates via Browser Geolocation API.
 *   2. Converting coordinates to human-readable address via Nominatim.
 *
 * SECURITY NOTE:
 *   Coordinates come ONLY from navigator.geolocation.
 *   No manual coordinate input is allowed anywhere in this module.
 */

const LocationModule = (() => {

  /* ─── Geolocation Options ────────────────────────────────── */
  const GEO_OPTIONS = {
    enableHighAccuracy: true,   // Request full GPS sensor accuracy
    timeout:            10000,  // Max wait: 10 seconds
    maximumAge:         0,      // Always fetch a fresh position
  };

  /* ─── Nominatim Config ───────────────────────────────────── */
  const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/reverse';
  // User-Agent header required by Nominatim usage policy
  const APP_UA = 'AbsensiLapangan/1.0 (field-attendance-app)';

  /* ─────────────────────────────────────────────────────────── */

  /**
   * Request the user's current GPS position from the browser.
   *
   * @returns {Promise<{ lat: number, lon: number }>}
   * @throws  {Object} { code: string, message: string }
   */
  function requestLocation() {
    return new Promise((resolve, reject) => {

      if (!navigator.geolocation) {
        reject({
          code:    'NOT_SUPPORTED',
          message: 'Browser Anda tidak mendukung Geolocation API. Gunakan browser modern seperti Chrome atau Firefox.',
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        /* onSuccess */
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },

        /* onError */
        (err) => {
          let message;
          switch (err.code) {
            case err.PERMISSION_DENIED:
              message =
                'Izin lokasi ditolak. Harap izinkan akses lokasi di pengaturan browser Anda, lalu muat ulang halaman.';
              break;
            case err.POSITION_UNAVAILABLE:
              message =
                'Informasi lokasi tidak tersedia. Pastikan GPS atau Layanan Lokasi aktif pada perangkat Anda.';
              break;
            case err.TIMEOUT:
              message =
                'Waktu pembacaan GPS habis (>10 detik). Pastikan Anda berada di area dengan sinyal GPS yang baik, lalu coba lagi.';
              break;
            default:
              message = 'Gagal membaca lokasi GPS. Silakan coba lagi.';
          }
          reject({ code: 'GEO_ERROR', message });
        },

        GEO_OPTIONS
      );
    });
  }

  /* ─────────────────────────────────────────────────────────── */

  /**
   * Reverse geocode: convert lat/lon to a human-readable address.
   * Uses OpenStreetMap Nominatim (free, no API key required).
   * Falls back gracefully if the service is unavailable.
   *
   * @param  {number} lat
   * @param  {number} lon
   * @returns {Promise<string>} Human-readable address string.
   */
  async function reverseGeocode(lat, lon) {
    const fallback = `Alamat tidak terdeteksi (Koordinat: ${lat.toFixed(6)}, ${lon.toFixed(6)})`;

    try {
      const url = new URL(NOMINATIM_BASE);
      url.searchParams.set('format',        'jsonv2');
      url.searchParams.set('lat',           lat.toString());
      url.searchParams.set('lon',           lon.toString());
      url.searchParams.set('accept-language', 'id,en');
      url.searchParams.set('addressdetails', '1');

      const response = await fetch(url.toString(), {
        method:  'GET',
        headers: {
          'Accept':     'application/json',
          'User-Agent': APP_UA,
        },
        signal: AbortSignal.timeout(8000),   // 8-second timeout
      });

      if (!response.ok) {
        throw new Error(`Nominatim HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.display_name) {
        return fallback;
      }

      // Build a shorter, more readable address from structured fields
      const addr = data.address || {};
      const parts = [
        addr.road          || addr.pedestrian || addr.path      || addr.footway,
        addr.quarter       || addr.neighbourhood || addr.suburb,
        addr.village       || addr.town       || addr.city_district,
        addr.city          || addr.regency    || addr.county,
        addr.state,
      ].filter(Boolean);

      // If we got structured parts, use them; otherwise fall back to display_name
      return parts.length >= 2
        ? parts.join(', ')
        : data.display_name;

    } catch (err) {
      console.warn('[LocationModule] Reverse geocoding failed:', err.message || err);
      return fallback;
    }
  }

  /* ─── Public API ─────────────────────────────────────────── */
  return { requestLocation, reverseGeocode };

})();
