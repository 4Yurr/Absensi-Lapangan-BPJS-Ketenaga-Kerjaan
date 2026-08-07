'use strict';

/**
 * map.js — Leaflet.js Read-Only Map Module
 * =========================================
 * Renders an interactive map showing the user's GPS position.
 * The marker is strictly read-only (non-draggable, non-interactive).
 * Panning and zooming are allowed for visual exploration only.
 * Includes defensive checks against missing Leaflet global (L).
 */

const MapModule = (() => {

  /* ─── Constants ─────────────────────────────────────────── */
  const TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';
  const DEFAULT_ZOOM = 16;

  /* ─── Module State ───────────────────────────────────────── */
  let _map    = null;
  let _marker = null;

  /* ─── Custom Marker Icon ─────────────────────────────────── */
  function _createIcon() {
    if (typeof L === 'undefined' || !L.divIcon) return null;
    return L.divIcon({
      className: 'custom-marker',
      html: '<div class="marker-pin"></div><div class="marker-pulse"></div>',
      iconSize:   [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -14],
    });
  }

  /**
   * Initialize the Leaflet map at given coordinates.
   * If map is already initialized, just update the marker position.
   *
   * @param {number} lat - Latitude from Geolocation API
   * @param {number} lon - Longitude from Geolocation API
   */
  function initMap(lat, lon) {
    if (typeof L === 'undefined') {
      console.warn('[MapModule] Leaflet library (L) is not loaded.');
      const container = document.getElementById('map');
      if (container) {
        container.innerHTML =
          '<div style="padding:24px;text-align:center;color:#8ba3c1;font-size:0.85rem;line-height:1.5;">' +
          '📍 Peta tidak dapat dimuat, namun <strong>koordinat GPS Anda tetap tercatat</strong> secara akurat.' +
          '</div>';
      }
      return;
    }

    if (_map) {
      // Map already exists — just update position
      updateMarker(lat, lon);
      return;
    }

    try {
      _map = L.map('map', {
        center:          [lat, lon],
        zoom:            DEFAULT_ZOOM,
        zoomControl:     true,
        dragging:        true,        // Allow panning to see surrounding area
        scrollWheelZoom: true,
        doubleClickZoom: false,       // Prevent accidental zoom on double tap
        boxZoom:         false,
        keyboard:        false,
      });

      // Tile Layer — OpenStreetMap (free, no API key)
      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTR,
        maxZoom:     19,
      }).addTo(_map);

      // Place read-only marker
      const icon = _createIcon();
      const markerOptions = {
        draggable:   false,    // ← STRICTLY READ-ONLY: cannot be moved
        interactive: false,    // ← no click events on marker itself
        keyboard:    false,
      };
      if (icon) markerOptions.icon = icon;

      _marker = L.marker([lat, lon], markerOptions).addTo(_map);

      _marker.bindPopup(
        '<strong>📍 Posisi Anda</strong><br><span style="font-size:0.75rem;opacity:0.8">Lokasi ini tidak dapat diubah</span>',
        { closeButton: false, autoPan: false }
      );

      // Show popup after brief delay
      setTimeout(() => { if (_marker) _marker.openPopup(); }, 600);
    } catch (err) {
      console.error('[MapModule] Failed to render map:', err);
    }
  }

  /**
   * Update marker and re-center map at new coordinates.
   * @param {number} lat
   * @param {number} lon
   */
  function updateMarker(lat, lon) {
    if (typeof L === 'undefined' || !_map || !_marker) return;
    try {
      const latlng = L.latLng(lat, lon);
      _marker.setLatLng(latlng);
      _map.setView(latlng, DEFAULT_ZOOM, { animate: true });
      setTimeout(() => { if (_marker) _marker.openPopup(); }, 400);
    } catch (err) {
      console.error('[MapModule] Failed to update marker:', err);
    }
  }

  /**
   * Force Leaflet to recalculate dimensions.
   * Must be called after the map container transitions from hidden to visible.
   */
  function invalidateSize() {
    if (_map && typeof _map.invalidateSize === 'function') {
      setTimeout(() => _map.invalidateSize({ animate: false }), 120);
    }
  }

  /**
   * Check if map has been initialized.
   * @returns {boolean}
   */
  function isReady() {
    return _map !== null;
  }

  /* ─── Public API ─────────────────────────────────────────── */
  return { initMap, updateMarker, invalidateSize, isReady };

})();
