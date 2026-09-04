/* ---------------------------------------------------------
   Máy Nghe Nhạc Của Tôi — offline music player (IndexedDB)
   --------------------------------------------------------- */

const DB_NAME = 'music-player-db';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains('songs')) {
        const store = _db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
        store.createIndex('addedAt', 'addedAt');
      }
      if (!_db.objectStoreNames.contains('playlists')) {
        _db.createObjectStore('playlists', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function addSong(song) {
  return reqToPromise(tx('songs', 'readwrite').add(song));
}
function getAllSongs() {
  return reqToPromise(tx('songs', 'readonly').getAll());
}
function getSong(id) {
  return reqToPromise(tx('songs', 'readonly').get(id));
}
function deleteSongRecord(id) {
  return reqToPromise(tx('songs', 'readwrite').delete(id));
}

function addPlaylist(pl) {
  return reqToPromise(tx('playlists', 'readwrite').add(pl));
}
function getAllPlaylists() {
  return reqToPromise(tx('playlists', 'readonly').getAll());
}
function putPlaylist(pl) {
  return reqToPromise(tx('playlists', 'readwrite').put(pl));
}
function deletePlaylistRecord(id) {
  return reqToPromise(tx('playlists', 'readwrite').delete(id));
}

/* ---------------------------------------------------------
   App state
   --------------------------------------------------------- */

let songs = [];          // [{id, name, blob, duration, addedAt}]
let playlists = [];      // [{id, name, songIds:[...]}]
let queue = [];          // array of song ids currently playing through
let queueIndex = -1;
let currentObjectUrl = null;
let isPlaying = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'
let shuffleOn = false;
let activePlaylistId = null; // which playlist detail view is open
let pickerTargetPlaylistId = null;
let pickerSelection = new Set();

const audioEl = document.getElementById('audio-el');

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function stripExt(name) {
  return name.replace(/\.[^/.]+$/, '');
}

function getSongDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    a.onloadedmetadata = () => {
      resolve(isFinite(a.duration) ? a.duration : 0);
      URL.revokeObjectURL(url);
    };
    a.onerror = () => { resolve(0); URL.revokeObjectURL(url); };
  });
}

/* ---------------------------------------------------------
   Upload
   --------------------------------------------------------- */

document.getElementById('upload-btn').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('empty-upload-btn').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  showToast(`Đang thêm ${files.length} bài...`);
  for (const file of files) {
    const duration = await getSongDuration(file);
    const song = {
      name: stripExt(file.name),
      type: file.type || 'audio/mpeg',
      size: file.size,
      blob: file,
      duration,
      addedAt: Date.now()
    };
    const id = await addSong(song);
    song.id = id;
    songs.push(song);
  }
  e.target.value = '';
  renderLibrary();
  showToast(`Đã thêm ${files.length} bài vào thư viện`);
});

/* ---------------------------------------------------------
   Rendering: Library
   --------------------------------------------------------- */

function renderLibrary() {
  const list = document.getElementById('library-list');
  const empty = document.getElementById('library-empty');
  const count = document.getElementById('library-count');
  list.innerHTML = '';
  count.textContent = `${songs.length} bài`;

  if (!songs.length) {
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  songs.forEach((song, i) => {
    list.appendChild(buildTrackRow(song, i + 1, {
      onPlay: () => playFromList(songs.map(s => s.id), song.id),
      onMenu: () => openTrackMenu(song)
    }));
  });
}

function buildTrackRow(song, index, { onPlay, onMenu, picking, checked, onToggle }) {
  const li = document.createElement('li');
  li.className = 'track-row';
  if (currentSongId() === song.id) li.classList.add('playing');

  const idx = document.createElement('span');
  idx.className = 'track-index mono';
  idx.textContent = String(index).padStart(2, '0');

  const main = document.createElement('button');
  main.className = 'track-main';
  const title = document.createElement('span');
  title.className = 'track-title';
  title.textContent = song.name;
  const sub = document.createElement('span');
  sub.className = 'track-sub';
  sub.textContent = formatTime(song.duration);
  main.appendChild(title);
  main.appendChild(sub);

  li.appendChild(idx);
  li.appendChild(main);

  if (picking) {
    main.addEventListener('click', onToggle);
    li.addEventListener('click', onToggle);
    const check = document.createElement('span');
    check.className = 'track-check';
    if (checked) {
      check.classList.add('checked');
      check.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 13l4 4 10-10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    li.appendChild(check);
  } else {
    main.addEventListener('click', onPlay);
    const dur = document.createElement('span');
    dur.className = 'track-dur mono';
    dur.textContent = formatTime(song.duration);
    const menuBtn = document.createElement('button');
    menuBtn.className = 'track-menu-btn';
    menuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg>';
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); onMenu(); });
    // remove the sub-duration text since we show it in track-dur instead
    main.removeChild(sub);
    li.appendChild(dur);
    li.appendChild(menuBtn);
  }

  return li;
}

function openTrackMenu(song) {
  const inAnyPlaylist = playlists.some(p => p.songIds.includes(song.id));
  const choice = confirm(`Xóa "${song.name}" khỏi thư viện?\n(Bài này sẽ bị gỡ khỏi mọi playlist)`);
  if (choice) deleteSongEverywhere(song.id);
}

async function deleteSongEverywhere(songId) {
  await deleteSongRecord(songId);
  songs = songs.filter(s => s.id !== songId);
  for (const p of playlists) {
    if (p.songIds.includes(songId)) {
      p.songIds = p.songIds.filter(id => id !== songId);
      await putPlaylist(p);
    }
  }
  if (currentSongId() === songId) stopPlayback();
  renderLibrary();
  renderPlaylists();
  if (activePlaylistId != null) renderPlaylistDetail(activePlaylistId);
  showToast('Đã xóa bài hát');
}

/* ---------------------------------------------------------
   Rendering: Playlists
   --------------------------------------------------------- */

function renderPlaylists() {
  const list = document.getElementById('playlist-list');
  const empty = document.getElementById('playlists-empty');
  list.innerHTML = '';

  if (!playlists.length) {
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  playlists.forEach(pl => {
    const li = document.createElement('li');
    const card = document.createElement('button');
    card.className = 'playlist-card';
    card.innerHTML = `
      <span class="playlist-card-icon">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 6h11M4 12h11M4 18h7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="19" cy="16" r="2.4" fill="currentColor"/><path d="M21.4 16V7l-3 1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
      </span>
      <span class="playlist-card-name">${escapeHtml(pl.name)}</span>
      <span class="playlist-card-count">${pl.songIds.length} bài</span>
    `;
    card.addEventListener('click', () => {
      activePlaylistId = pl.id;
      renderPlaylistDetail(pl.id);
      switchView('view-playlist-detail');
    });
    li.appendChild(card);
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderPlaylistDetail(playlistId) {
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) return;
  document.getElementById('playlist-detail-name').textContent = pl.name;
  const list = document.getElementById('playlist-detail-list');
  list.innerHTML = '';
  const plSongs = pl.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean);

  plSongs.forEach((song, i) => {
    list.appendChild(buildTrackRow(song, i + 1, {
      onPlay: () => playFromList(pl.songIds, song.id),
      onMenu: () => {
        if (confirm(`Bỏ "${song.name}" khỏi playlist "${pl.name}"?`)) {
          pl.songIds = pl.songIds.filter(id => id !== song.id);
          putPlaylist(pl).then(() => {
            renderPlaylistDetail(playlistId);
            renderPlaylists();
          });
        }
      }
    }));
  });
}

document.getElementById('back-to-playlists').addEventListener('click', () => {
  activePlaylistId = null;
  switchView('view-playlists');
});

document.getElementById('export-playlist-btn').addEventListener('click', () => {
  if (activePlaylistId != null) exportPlaylist(activePlaylistId);
});

document.getElementById('delete-playlist-btn').addEventListener('click', () => {
  const pl = playlists.find(p => p.id === activePlaylistId);
  if (!pl) return;
  if (confirm(`Xóa playlist "${pl.name}"? (Nhạc trong thư viện vẫn còn)`)) {
    deletePlaylistRecord(pl.id).then(() => {
      playlists = playlists.filter(p => p.id !== pl.id);
      activePlaylistId = null;
      renderPlaylists();
      switchView('view-playlists');
      showToast('Đã xóa playlist');
    });
  }
});

/* ---------------------------------------------------------
   New playlist modal
   --------------------------------------------------------- */

function openNamePrompt() {
  const backdrop = document.getElementById('name-backdrop');
  const input = document.getElementById('playlist-name-input');
  input.value = '';
  backdrop.hidden = false;
  setTimeout(() => input.focus(), 50);
}
function closeNamePrompt() {
  document.getElementById('name-backdrop').hidden = true;
}

document.getElementById('new-playlist-btn').addEventListener('click', openNamePrompt);
document.getElementById('empty-playlist-btn').addEventListener('click', openNamePrompt);
document.getElementById('name-cancel').addEventListener('click', closeNamePrompt);

document.getElementById('name-confirm').addEventListener('click', async () => {
  const input = document.getElementById('playlist-name-input');
  const name = input.value.trim();
  if (!name) { showToast('Nhập tên playlist đã bạn'); return; }
  const pl = { name, songIds: [], createdAt: Date.now() };
  const id = await addPlaylist(pl);
  pl.id = id;
  playlists.push(pl);
  closeNamePrompt();
  renderPlaylists();
  showToast('Đã tạo playlist');
});

document.getElementById('playlist-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('name-confirm').click();
});

/* ---------------------------------------------------------
   Song picker modal (add songs to a playlist)
   --------------------------------------------------------- */

document.getElementById('add-songs-to-playlist-btn').addEventListener('click', () => {
  if (!songs.length) { showToast('Thư viện chưa có bài nào để thêm'); return; }
  pickerTargetPlaylistId = activePlaylistId;
  const pl = playlists.find(p => p.id === activePlaylistId);
  pickerSelection = new Set(pl ? pl.songIds : []);
  renderPicker();
  document.getElementById('picker-backdrop').hidden = false;
});

function renderPicker() {
  const list = document.getElementById('picker-list');
  list.innerHTML = '';
  songs.forEach((song, i) => {
    list.appendChild(buildTrackRow(song, i + 1, {
      picking: true,
      checked: pickerSelection.has(song.id),
      onToggle: () => {
        if (pickerSelection.has(song.id)) pickerSelection.delete(song.id);
        else pickerSelection.add(song.id);
        renderPicker();
      }
    }));
  });
}

document.getElementById('picker-close').addEventListener('click', () => {
  document.getElementById('picker-backdrop').hidden = true;
});

document.getElementById('picker-done').addEventListener('click', async () => {
  const pl = playlists.find(p => p.id === pickerTargetPlaylistId);
  if (pl) {
    pl.songIds = Array.from(pickerSelection);
    await putPlaylist(pl);
    renderPlaylistDetail(pl.id);
    renderPlaylists();
  }
  document.getElementById('picker-backdrop').hidden = true;
});

/* ---------------------------------------------------------
   Tabs / views
   --------------------------------------------------------- */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = `view-${tab.dataset.tab}`;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    switchView(target);
  });
});

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  // keep tab highlight sensible when jumping into detail view
  if (viewId === 'view-playlist-detail' || viewId === 'view-playlists') {
    document.querySelectorAll('.tab').forEach(t => {
      const match = t.dataset.tab === 'playlists';
      t.classList.toggle('active', match);
      t.setAttribute('aria-selected', match ? 'true' : 'false');
    });
  }
}

/* ---------------------------------------------------------
   Player
   --------------------------------------------------------- */

function currentSongId() {
  return queueIndex >= 0 && queue[queueIndex] != null ? queue[queueIndex] : null;
}

function playFromList(idList, startId) {
  queue = idList.slice();
  queueIndex = queue.indexOf(startId);
  playCurrent();
}

async function playCurrent() {
  const id = currentSongId();
  if (id == null) return;
  const song = songs.find(s => s.id === id) || await getSong(id);
  if (!song) return;

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(song.blob);
  audioEl.src = currentObjectUrl;
  audioEl.play().then(() => {
    isPlaying = true;
    updatePlayButton();
  }).catch(() => {});

  document.getElementById('np-title').textContent = song.name;
  document.getElementById('np-sub').textContent = 'Đang phát';
  document.getElementById('disc').classList.add('spinning');
  renderLibrary();
  if (activePlaylistId != null) renderPlaylistDetail(activePlaylistId);
}

function stopPlayback() {
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  queue = [];
  queueIndex = -1;
  isPlaying = false;
  updatePlayButton();
  document.getElementById('np-title').textContent = 'Chưa chọn bài nào';
  document.getElementById('np-sub').textContent = 'Thêm nhạc để bắt đầu';
  document.getElementById('disc').classList.remove('spinning');
}

function updatePlayButton() {
  document.getElementById('icon-play').hidden = isPlaying;
  document.getElementById('icon-pause').hidden = !isPlaying;
  document.getElementById('disc').classList.toggle('spinning', isPlaying);
}

document.getElementById('btn-play').addEventListener('click', () => {
  if (currentSongId() == null) {
    if (songs.length) playFromList(songs.map(s => s.id), songs[0].id);
    return;
  }
  if (isPlaying) {
    audioEl.pause();
    isPlaying = false;
  } else {
    audioEl.play();
    isPlaying = true;
  }
  updatePlayButton();
});

document.getElementById('btn-next').addEventListener('click', () => goNext(true));
document.getElementById('btn-prev').addEventListener('click', () => {
  if (audioEl.currentTime > 3) { audioEl.currentTime = 0; return; }
  goPrev();
});

function goNext(userTriggered) {
  if (!queue.length) return;
  if (shuffleOn) {
    queueIndex = Math.floor(Math.random() * queue.length);
  } else {
    queueIndex++;
    if (queueIndex >= queue.length) {
      if (repeatMode === 'all') queueIndex = 0;
      else { stopPlayback(); return; }
    }
  }
  playCurrent();
}

function goPrev() {
  if (!queue.length) return;
  queueIndex--;
  if (queueIndex < 0) queueIndex = repeatMode === 'all' ? queue.length - 1 : 0;
  playCurrent();
}

document.getElementById('btn-shuffle').addEventListener('click', (e) => {
  shuffleOn = !shuffleOn;
  e.currentTarget.classList.toggle('active', shuffleOn);
  showToast(shuffleOn ? 'Đã bật phát ngẫu nhiên' : 'Đã tắt phát ngẫu nhiên');
});

const repeatBtnEl = document.getElementById('btn-repeat');
const repeatBadgeEl = document.getElementById('repeat-one-badge');

function updateRepeatButton() {
  repeatBtnEl.classList.toggle('active', repeatMode !== 'off');
  repeatBadgeEl.classList.toggle('show', repeatMode === 'one');
}

repeatBtnEl.addEventListener('click', () => {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  updateRepeatButton();
  const msg = repeatMode === 'all' ? 'Đã bật lặp lại tất cả'
    : repeatMode === 'one' ? 'Đã bật lặp lại 1 bài'
    : 'Đã tắt lặp lại';
  showToast(msg);
});

audioEl.addEventListener('ended', () => {
  if (repeatMode === 'one') {
    audioEl.currentTime = 0;
    audioEl.play();
    return;
  }
  goNext(false);
});

audioEl.addEventListener('timeupdate', () => {
  if (!isScrubbing) {
    const pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
    document.getElementById('scrubber').value = pct;
  }
  document.getElementById('time-current').textContent = formatTime(audioEl.currentTime);
  document.getElementById('time-total').textContent = formatTime(audioEl.duration || 0);
});

let isScrubbing = false;
const scrubberEl = document.getElementById('scrubber');
scrubberEl.addEventListener('input', () => { isScrubbing = true; });
scrubberEl.addEventListener('change', () => {
  if (audioEl.duration) {
    audioEl.currentTime = (scrubberEl.value / 100) * audioEl.duration;
  }
  isScrubbing = false;
});

/* ---------------------------------------------------------
   Sync: export / import library as a single file
   --------------------------------------------------------- */

async function exportBundle(songList, playlistList, fileNameBase, subEl) {
  if (!songList.length && !playlistList.length) {
    showToast('Không có gì để xuất');
    return;
  }
  const originalSub = subEl ? subEl.textContent : null;

  // Manifest holds metadata only (no audio bytes) — audio blobs are appended
  // to the file directly afterwards, in the same order, with no re-encoding.
  const manifest = {
    version: 2,
    exportedAt: Date.now(),
    songs: songList.map(s => ({
      id: s.id, name: s.name, type: s.type, size: s.blob.size,
      duration: s.duration, addedAt: s.addedAt
    })),
    playlists: playlistList
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const lenPrefix = new Uint8Array(4);
  new DataView(lenPrefix.buffer).setUint32(0, manifestBytes.byteLength, true);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${fileNameBase}-${dateStr}.nhacbak`;

  if (window.showSaveFilePicker) {
    // Best path: write straight to disk, one song at a time. The whole
    // bundle is never held in memory at once, so this is safe for any size.
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Sao lưu nhạc', accept: { 'application/octet-stream': ['.nhacbak'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(lenPrefix);
      await writable.write(manifestBytes);
      for (let i = 0; i < songList.length; i++) {
        if (subEl) subEl.textContent = `Đang ghi... (${i + 1}/${songList.length})`;
        await writable.write(songList[i].blob);
      }
      await writable.close();
      if (subEl) subEl.textContent = originalSub;
      showToast('Đã xuất xong file');
    } catch (err) {
      if (subEl) subEl.textContent = originalSub;
      if (err && err.name === 'AbortError') return; // user closed the save dialog
      showToast('Xuất file thất bại, thử lại nhé');
    }
    return;
  }

  // Fallback for browsers without the File System Access API (e.g. most
  // mobile browsers). Fine for smaller bundles; very large ones may still
  // use noticeable memory since everything has to be joined before download.
  const totalBytes = songList.reduce((sum, s) => sum + s.blob.size, 0);
  if (totalBytes > 300 * 1024 * 1024) {
    const ok = confirm('Nội dung khá lớn và trình duyệt này không hỗ trợ ghi file trực tiếp, có thể tốn nhiều bộ nhớ. Vẫn muốn tiếp tục?');
    if (!ok) return;
  }
  if (subEl) subEl.textContent = 'Đang chuẩn bị file...';
  const parts = [lenPrefix, manifestBytes, ...songList.map(s => s.blob)];
  const blob = new Blob(parts, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  if (subEl) subEl.textContent = originalSub;
  showToast('Đã xuất xong file');
}

function exportLibrary() {
  const subEl = document.getElementById('sync-export-sub');
  return exportBundle(songs, playlists, 'nhac-cua-toi', subEl);
}

function exportPlaylist(playlistId) {
  const pl = playlists.find(p => p.id === playlistId);
  if (!pl) return;
  const plSongs = pl.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean);
  const safeName = pl.name.trim().replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '-') || 'playlist';
  return exportBundle(plSongs, [pl], safeName, null);
}

async function importLibraryFromFile(file) {
  showToast('Đang đọc file...');
  try {
    const lenBuf = await file.slice(0, 4).arrayBuffer();
    const manifestLen = new DataView(lenBuf).getUint32(0, true);
    const manifestText = await file.slice(4, 4 + manifestLen).text();
    const manifest = JSON.parse(manifestText);

    let offset = 4 + manifestLen;
    const idMap = {};
    let added = 0, skipped = 0;

    for (const s of (manifest.songs || [])) {
      // Slice the audio bytes straight out of the uploaded file — this is a
      // cheap reference, not a full read into memory.
      const songBlob = file.slice(offset, offset + s.size, s.type);
      offset += s.size;

      const dup = songs.find(existing => existing.name === s.name && existing.size === s.size);
      if (dup) { idMap[s.id] = dup.id; skipped++; continue; }

      const newSong = { name: s.name, type: s.type, size: s.size, blob: songBlob, duration: s.duration, addedAt: s.addedAt || Date.now() };
      const newId = await addSong(newSong);
      newSong.id = newId;
      songs.push(newSong);
      idMap[s.id] = newId;
      added++;
    }

    for (const p of (manifest.playlists || [])) {
      const mappedIds = (p.songIds || []).map(oldId => idMap[oldId]).filter(id => id != null);
      const existingPl = playlists.find(pl => pl.name === p.name);
      if (existingPl) {
        existingPl.songIds = Array.from(new Set([...existingPl.songIds, ...mappedIds]));
        await putPlaylist(existingPl);
      } else {
        const newPl = { name: p.name, songIds: mappedIds, createdAt: p.createdAt || Date.now() };
        const newId = await addPlaylist(newPl);
        newPl.id = newId;
        playlists.push(newPl);
      }
    }

    songs.sort((a, b) => b.addedAt - a.addedAt);
    renderLibrary();
    renderPlaylists();
    showToast(`Đã nhập ${added} bài mới (bỏ qua ${skipped} bài trùng)`);
  } catch (err) {
    showToast('File không hợp lệ, không đọc được');
  }
}


document.getElementById('export-btn').addEventListener('click', exportLibrary);
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) await importLibraryFromFile(file);
});

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */

async function init() {
  db = await openDB();
  songs = await getAllSongs();
  songs.sort((a, b) => b.addedAt - a.addedAt);
  playlists = await getAllPlaylists();
  renderLibrary();
  renderPlaylists();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
