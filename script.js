'use strict';

// Images are read and stored locally; no backend or external API is needed.
const STORAGE_KEY = 'dropzone.images.v1';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const STORAGE_BUDGET = 5 * 1024 * 1024; // illustrative UTF-16 estimate, not the actual browser quota
const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
const $ = (id) => document.getElementById(id);
const input = $('file-input');
const zone = $('drop-zone');
let images = [];
let active = 0;
let dragDepth = 0;
let serial = Promise.resolve();
let storageAvailable = true;
let sequence = 0;

function announce(message) { $('announcement').textContent = message; }
function error(message) {
  const p = document.createElement('p');
  p.textContent = message;
  $('messages').append(p);
  $('messages').hidden = false;
}
function resetErrors() { $('messages').replaceChildren(); $('messages').hidden = true; }
function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${(bytes / 1024).toFixed(bytes < 1024 ? 1 : 0)} KB`;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function serialized(list) { return JSON.stringify(list.map(({ id, name, size, type, data }) => ({ id, name, size, type, data }))); }
function usedBytes(list) { return list.length ? serialized(list).length * 2 : 0; }
function isStoredImage(item) {
  return item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(item.size) && item.size > 0 && item.size <= MAX_FILE_BYTES && Object.values(types).includes(item.type) && typeof item.data === 'string' && item.data.startsWith(`data:${item.type};base64,`);
}

// Restore previously saved images; a corrupted or inaccessible store must not crash the UI.
function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Invalid saved gallery');
      const ids = new Set();
      images = parsed.filter(item => {
        if (!isStoredImage(item) || ids.has(item.id)) return false;
        ids.add(item.id); return true;
      }).map(item => ({ ...item, saved: true }));
      if (images.length !== parsed.length) error('Some invalid saved image records were ignored.');
    }
  } catch (err) {
    if (err instanceof SyntaxError || err.message === 'Invalid saved gallery') {
      error('Saved gallery data could not be read. New uploads can replace it.');
    } else {
      storageAvailable = false;
      error('Local storage is unavailable. Images will remain visible only until this page is refreshed.');
    }
  }
}
function persist(list) {
  try {
    if (list.length) localStorage.setItem(STORAGE_KEY, serialized(list));
    else localStorage.removeItem(STORAGE_KEY);
    storageAvailable = true;
    return true;
  } catch {
    storageAvailable = false;
    return false;
  }
}
function saveImage(image) {
  const candidates = [...images.filter(item => item.saved), image];
  if (!persist(candidates)) {
    error(`${image.name}: browser storage is full or unavailable. Preview is available for this session only.`);
    return false;
  }
  return true;
}
function removeImage(id) {
  const target = images.find(item => item.id === id);
  if (!target) return;
  const remaining = images.filter(item => item.id !== id);
  if (target.saved && !persist(remaining.filter(item => item.saved))) {
    error('Could not remove the saved image from browser storage. Please enable storage and try again.');
    renderGallery(); return;
  }
  images = remaining;
  renderGallery(); announce(`${target.name} removed.`);
}
function renderGallery() {
  const gallery = $('gallery');
  gallery.replaceChildren();
  $('gallery-count').textContent = images.length;
  $('empty-gallery').hidden = images.length !== 0;
  $('clear-all').disabled = images.length === 0;
  const saved = images.filter(item => item.saved);
  const bytes = usedBytes(saved);
  $('storage-label').textContent = `${formatSize(bytes)} saved / ~5 MB guide`;
  $('storage-fill').style.width = `${Math.min(100, bytes / STORAGE_BUDGET * 100)}%`;
  const temporary = images.length - saved.length;
  $('storage-note').textContent = temporary ? `${saved.length} saved · ${temporary} session-only (lost on refresh).` : storageAvailable ? 'Saved images reappear after a page refresh. Actual browser limits vary.' : 'Browser storage is currently unavailable.';
  for (const item of images) {
    const card = element('article', 'image-card');
    const thumb = element('button', 'thumb-button'); thumb.type = 'button'; thumb.setAttribute('aria-label', `Preview ${item.name}`);
    const img = element('img'); img.src = item.data; img.alt = item.name; img.loading = 'lazy';
    const zoom = element('span', 'zoom-hint', 'View full'); thumb.append(img, zoom);
    thumb.addEventListener('click', () => {
      $('preview-title').textContent = item.name;
      $('large-preview').src = item.data;
      $('large-preview').alt = item.name;
      $('preview-detail').textContent = `${formatSize(item.size)} · ${item.saved ? 'Saved locally' : 'Session only'}`;
      $('preview-dialog').showModal();
    });
    const meta = element('div', 'image-meta'); const info = element('div');
    const name = element('span', 'image-name', item.name); name.title = item.name;
    info.append(name, element('span', 'image-size', `${formatSize(item.size)} · ${item.saved ? 'Saved' : 'Session only'}`));
    const remove = element('button', 'icon-button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${item.name}`); remove.title = 'Remove image';
    // Constant markup only. File names and other user-controlled text use textContent.
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';
    remove.addEventListener('click', () => removeImage(item.id));
    meta.append(info, remove); card.append(thumb, meta); gallery.append(card);
  }
}

function checkFile(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  const expected = Object.hasOwn(types, ext) ? types[ext] : null;
  if (!expected || (file.type && file.type.toLowerCase() !== expected)) throw new Error('Only JPG, JPEG, PNG and GIF images are allowed.');
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Image exceeds the 5 MB file size limit.');
  return expected;
}
async function checkSignature(file, type) {
  // Inspect actual file bytes as well as filename and MIME type to reject renamed files.
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = (values) => values.every((value, i) => b[i] === value);
  const valid = type === 'image/jpeg' ? matches([255, 216, 255]) : type === 'image/png' ? matches([137,80,78,71,13,10,26,10]) : matches([71,73,70,56,55,97]) || matches([71,73,70,56,57,97]);
  if (!valid) throw new Error('The file contents do not match a supported image format.');
}
function readImage(file, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // Normalize MIME for browsers that report an empty file type.
      const data = `data:${type};base64,${result.slice(result.indexOf(',') + 1)}`;
      const img = new Image();
      img.onload = () => resolve(data);
      img.onerror = () => reject(new Error('This image is damaged or cannot be opened.'));
      img.src = data;
    };
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.onabort = () => reject(new Error('Image reading was cancelled.'));
    reader.readAsDataURL(file);
  });
}
function updateActive() {
  $('queue-count').textContent = active ? `${active} active upload${active === 1 ? '' : 's'}` : 'No active uploads';
  $('queue-empty').hidden = $('queue').children.length !== 0;
}
function makeProgress(file) {
  const row = element('div', 'queue-row');
  const icon = element('span', 'queue-icon', file.name.split('.').pop().slice(0, 4).toUpperCase());
  const info = element('div', 'queue-info'); const top = element('div', 'queue-top');
  const name = element('span', 'queue-name', file.name); name.title = file.name;
  const percent = element('span', 'queue-percent', '0%'); top.append(name, percent);
  const track = element('div', 'progress-track'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', `Upload progress for ${file.name}`); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', '0');
  const fill = element('div', 'progress-fill'); track.append(fill);
  const status = element('div', 'queue-status', 'Queued…'); info.append(top, track, status); row.append(icon, info);
  $('queue').prepend(row); updateActive();
  return { row, percent, track, fill, status };
}
function setProgress(ui, value, status) {
  ui.fill.style.width = `${value}%`; ui.percent.textContent = `${value}%`; ui.track.setAttribute('aria-valuenow', String(value)); ui.status.textContent = status;
}
// Intentionally use setTimeout, as required by the assignment, to simulate an upload.
function simulateUpload(ui) {
  return new Promise(resolve => {
    let progress = 0;
    function tick() {
      progress = Math.min(100, progress + 10);
      setProgress(ui, progress, progress === 100 ? 'Finalizing preview…' : 'Simulating upload…');
      if (progress < 100) setTimeout(tick, 110); else resolve();
    }
    setTimeout(tick, 110);
  });
}
async function processFile(file, type, ui) {
  try {
    ui.status.textContent = 'Validating image…';
    await checkSignature(file, type);
    const data = await readImage(file, type);
    await simulateUpload(ui);
    const image = { id: `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, size: file.size, type, data, saved: false };
    image.saved = saveImage(image); images.push(image);
    ui.row.classList.add('done'); setProgress(ui, 100, image.saved ? 'Complete · saved locally' : 'Complete · session only');
    renderGallery(); announce(`${file.name} uploaded. ${image.saved ? 'Saved locally.' : 'Session only.'}`);
  } catch (err) {
    ui.row.classList.add('failed'); ui.status.textContent = 'Failed · invalid or unreadable image'; ui.percent.textContent = 'Failed';
    error(`${file.name}: ${err.message || 'Unable to process this file.'}`);
  } finally {
    active--; updateActive();
    // Limit completed history while never dropping rows that are still queued or uploading.
    const finished = [...$('queue').children].filter(row => row.classList.contains('done') || row.classList.contains('failed'));
    finished.slice(8).forEach(row => row.remove());
  }
}
function handleFiles(files) {
  resetErrors();
  for (const file of files) {
    try {
      const type = checkFile(file);
      active++; const ui = makeProgress(file);
      // Serial processing avoids overlapping writes to localStorage and limits memory spikes.
      serial = serial.then(() => processFile(file, type, ui));
    } catch (err) { error(`${file.name}: ${err.message}`); }
  }
  updateActive();
}
$('browse').addEventListener('click', () => input.click());
input.addEventListener('change', () => { handleFiles(Array.from(input.files)); input.value = ''; });
zone.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; zone.classList.add('is-dragging'); });
zone.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
zone.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) zone.classList.remove('is-dragging'); });
zone.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; zone.classList.remove('is-dragging'); if (event.dataTransfer) handleFiles(Array.from(event.dataTransfer.files)); });
// Avoid navigating away if a file is dropped outside the target.
window.addEventListener('dragover', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
$('close-preview').addEventListener('click', () => $('preview-dialog').close());
$('preview-dialog').addEventListener('close', () => $('large-preview').removeAttribute('src'));
$('clear-all').addEventListener('click', () => $('clear-dialog').showModal());
$('cancel-clear').addEventListener('click', () => $('clear-dialog').close());
$('confirm-clear').addEventListener('click', () => {
  if (images.some(item => item.saved) && !persist([])) { error('Could not clear browser storage. Please try again.'); $('clear-dialog').close(); return; }
  images = []; renderGallery(); $('clear-dialog').close(); announce('Gallery cleared.');
});
restore(); renderGallery(); updateActive();
