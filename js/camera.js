'use strict';

/**
 * camera.js — Photo Capture & Compression Module
 * ================================================
 * Handles:
 *   1. Accepting image file from <input type="file">.
 *   2. Compressing / resizing via Canvas API (client-side).
 *   3. Converting to Base64 JPEG string for payload.
 *
 * Compression targets:
 *   - Max dimension: 1024px (width or height)
 *   - JPEG quality:  0.75 (75%) — balances quality vs. file size
 *   - Typical output: 150–400 KB (down from 2–8 MB raw camera)
 */

const CameraModule = (() => {

  /* ─── Config ─────────────────────────────────────────────── */
  const MAX_DIMENSION = 1024;   // px
  const JPEG_QUALITY  = 0.75;   // 0.0 – 1.0

  /* ─── Internal State ─────────────────────────────────────── */
  let _base64   = null;
  let _fileName = null;

  /* ─────────────────────────────────────────────────────────── */

  /**
   * Compress an Image object onto a Canvas and export as Base64 JPEG.
   *
   * @param {File}   file - The selected image file.
   * @returns {Promise<{ base64: string, fileName: string }>}
   */
  function _compress(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));

      reader.onload = (readerEvent) => {
        const img = new Image();

        img.onerror = () => reject(new Error('Gagal memuat gambar dari file yang dipilih.'));

        img.onload = () => {
          let { width, height } = img;

          // Proportional resize if exceeds max dimension
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width >= height) {
              height = Math.round((height / width) * MAX_DIMENSION);
              width  = MAX_DIMENSION;
            } else {
              width  = Math.round((width / height) * MAX_DIMENSION);
              height = MAX_DIMENSION;
            }
          }

          // Draw onto off-screen canvas
          const canvas = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          // White background (avoids transparent PNG becoming black after JPEG conversion)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const base64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          resolve({ base64, fileName: file.name });
        };

        img.src = readerEvent.target.result;
      };

      reader.readAsDataURL(file);
    });
  }

  /* ─────────────────────────────────────────────────────────── */

  /**
   * Process a selected file: validate, compress, and store internally.
   *
   * @param {File}     file      - Image file from <input>.
   * @param {Function} onSuccess - Called with (base64String).
   * @param {Function} onError   - Called with (errorMessage).
   */
  async function processFile(file, onSuccess, onError) {
    if (!file) {
      onError('Tidak ada file yang dipilih.');
      return;
    }

    if (!file.type.startsWith('image/')) {
      onError(`File "${file.name}" bukan gambar. Pilih file berformat JPEG, PNG, WEBP, atau HEIC.`);
      return;
    }

    // Basic size sanity check (max 25 MB raw)
    const MAX_RAW_MB = 25;
    if (file.size > MAX_RAW_MB * 1024 * 1024) {
      onError(`File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksimal ${MAX_RAW_MB} MB.`);
      return;
    }

    try {
      const { base64, fileName } = await _compress(file);
      _base64   = base64;
      _fileName = fileName;
      onSuccess(base64);
    } catch (err) {
      _base64   = null;
      _fileName = null;
      onError(err.message || 'Gagal memproses gambar. Coba pilih foto lain.');
    }
  }

  /**
   * Retrieve stored Base64 image string.
   * @returns {string|null}
   */
  function getBase64() { return _base64; }

  /**
   * Retrieve stored original file name.
   * @returns {string|null}
   */
  function getFileName() { return _fileName; }

  /**
   * Clear stored photo data (call after successful submit or on reset).
   */
  function reset() {
    _base64   = null;
    _fileName = null;
  }

  /* ─── Public API ─────────────────────────────────────────── */
  return { processFile, getBase64, getFileName, reset };

})();
