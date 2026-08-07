'use strict';

/**
 * map.js — Leaflet.js Read-Only Map Module
 * =========================================
 * Renders an interactive map showing the user's GPS position.
 * The marker is strictly read-only (non-draggable, non-interactive).
 * Panning and zooming are allowed for visual exploration only.
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
    if (_map) {
      // Map already exists — just update position
      updateMarker(lat, lon);
      return;
    }

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
    _marker = L.marker([lat, lon], {
      icon:        _createIcon(),
      draggable:   false,    // ← STRICTLY READ-ONLY: cannot be moved
      interactive: false,    // ← no click events on marker itself
      keyboard:    false,
    }).addTo(_map);

    _marker.bindPopup(
      '<strong>📍 Posisi Anda</strong><br><span style="font-size:0.75rem;opacity:0.8">Lokasi ini tidak dapat diubah</span>',
      { closeButton: false, autoPan: false }
    );

    // Show popup after brief delay
    setTimeout(() => { if (_marker) _marker.openPopup(); }, 600);
  }

  /**
   * Update marker and re-center map at new coordinates.
   * @param {number} lat
   * @param {number} lon
   */
  function updateMarker(lat, lon) {
    if (!_map || !_marker) return;
    const latlng = L.latLng(lat, lon);
    _marker.setLatLng(latlng);
    _map.setView(latlng, DEFAULT_ZOOM, { animate: true });
    setTimeout(() => { if (_marker) _marker.openPopup(); }, 400);
  }

  /**
   * Force Leaflet to recalculate dimensions.
   * Must be called after the map container transitions from hidden to visible.
   */
  function invalidateSize() {
    if (_map) {
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
