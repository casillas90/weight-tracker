/**
 * storage.js - Multi-layer Resilient Storage Engine for Weight Tracker
 * Supports LocalStorage + Local Backup + IndexedDB + Google Sheets Cloud Sync
 *
 * ⚠️ 데이터 호환성 규칙: 아래 키 이름과 IndexedDB 이름은 배포된 모든 사용자의
 * 기존 기록이 저장된 위치입니다. 절대 이름을 바꾸지 마세요.
 */

const STORAGE_KEYS = {
  ENTRIES: 'weight_tracker_entries',
  BACKUP: 'weight_tracker_entries_backup',
  SNAPSHOT: 'weight_tracker_entries_snapshot',   // 삭제/복원/초기화 직전 상태 (되돌리기용)
  PROFILE: 'weight_tracker_profile',
  CLOUD: 'weight_tracker_cloud_config',
  THEME: 'weight_tracker_theme'
};

const DEFAULT_PROFILE = {
  height: 175,             // cm
  initialWeight: 75.0,      // kg
  targetWeight: 68.0,       // kg
  targetDate: '2026-12-31',
  gender: 'male',
  unit: 'kg'
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ==========================================================================
// IndexedDB Helper (Tertiary Storage for Zero Data Loss)
// ==========================================================================
const IDB_NAME = 'FitTrackDB';
const IDB_STORE = 'weight_store';

let idbPromise = null;
function openIDB() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
  return idbPromise;
}

async function idbSet(key, value) {
  try {
    const db = await openIDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (e) {
    console.warn('IDB write skipped', e);
  }
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('LocalStorage write failed:', key, e);
    return false;
  }
}

function parseArray(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch (_) {
    return null;
  }
}

// Safely ensure entries key exists without wiping existing data
(() => {
  const existing = parseArray(lsGet(STORAGE_KEYS.ENTRIES));
  const backup = parseArray(lsGet(STORAGE_KEYS.BACKUP));
  if (!existing && backup) {
    // 기본 키가 없거나 깨졌을 때만 백업에서 복구 (빈 배열 '[]'은 사용자가 의도적으로 비운 상태)
    lsSet(STORAGE_KEYS.ENTRIES, JSON.stringify(backup));
  }
})();

export function getLocalDateString(d = new Date()) {
  const dateObj = typeof d === 'string' ? parseLocalDate(d) : d;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 'YYYY-MM-DD'를 UTC가 아닌 로컬 자정 기준 Date로 변환
export function parseLocalDate(dateStr) {
  if (typeof dateStr === 'string' && DATE_RE.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// 화면/분석용으로 쓸 수 있는 정상 기록인지 확인하고 숫자형으로 정리한 사본을 돌려준다.
// 원본 저장 데이터는 절대 변형하지 않는다.
function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  let date = typeof e.date === 'string' ? e.date.trim() : '';
  if (!DATE_RE.test(date) && date) {
    const parsed = new Date(date);
    if (!isNaN(parsed)) date = getLocalDateString(parsed);
  }
  const weight = toNumOrNull(e.weight);
  if (!DATE_RE.test(date) || weight === null || weight <= 0) return null;
  return {
    ...e,
    id: e.id || date,
    date,
    weight,
    bodyFat: toNumOrNull(e.bodyFat),
    muscleMass: toNumOrNull(e.muscleMass),
    note: e.note == null ? '' : String(e.note),
    tags: Array.isArray(e.tags) ? e.tags : []
  };
}

function sortEntriesDesc(entries) {
  return entries.sort((a, b) => {
    const ad = String(a?.date || ''), bd = String(b?.date || '');
    if (bd !== ad) {
      return bd.localeCompare(ad);
    }
    return (b?.time || '12:00').localeCompare(a?.time || '12:00');
  });
}

function isDateKey(key) {
  return typeof key === 'string' && DATE_RE.test(key);
}

export const Storage = {
  // 저장소에 있는 원본 배열 (형식이 이상한 항목까지 그대로 보존)
  readRawEntries() {
    let data = parseArray(lsGet(STORAGE_KEYS.ENTRIES));
    if (!data) {
      const backup = parseArray(lsGet(STORAGE_KEYS.BACKUP));
      if (backup) {
        data = backup;
        lsSet(STORAGE_KEYS.ENTRIES, JSON.stringify(backup));
      }
    }
    return data || [];
  },

  // Get all valid weight entries, sorted descending by date
  getEntries() {
    const list = this.readRawEntries().map(normalizeEntry).filter(Boolean);
    return sortEntriesDesc(list);
  },

  // 위험한 작업 직전에 현재 상태를 보관 (되돌리기용)
  saveSnapshot(reason = '') {
    const raw = this.readRawEntries();
    if (raw.length === 0) return;
    const snap = { savedAt: new Date().toISOString(), reason, entries: raw };
    lsSet(STORAGE_KEYS.SNAPSHOT, JSON.stringify(snap));
    idbSet('snapshot', snap);
  },

  getSnapshotInfo() {
    try {
      const raw = lsGet(STORAGE_KEYS.SNAPSHOT);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.entries) || snap.entries.length === 0) return null;
      return { savedAt: snap.savedAt, reason: snap.reason, count: snap.entries.length };
    } catch (_) {
      return null;
    }
  },

  restoreSnapshot() {
    const raw = lsGet(STORAGE_KEYS.SNAPSHOT);
    const snap = raw ? JSON.parse(raw) : null;
    if (!snap || !Array.isArray(snap.entries) || snap.entries.length === 0) {
      throw new Error('되돌릴 수 있는 이전 기록이 없습니다.');
    }
    const current = this.readRawEntries();
    this.saveAllEntries(snap.entries);
    // 되돌리기를 다시 되돌릴 수 있도록 현재 상태를 스냅샷으로 교체
    if (current.length > 0) {
      const back = { savedAt: new Date().toISOString(), reason: '되돌리기 직전', entries: current };
      lsSet(STORAGE_KEYS.SNAPSHOT, JSON.stringify(back));
      idbSet('snapshot', back);
    }
    return snap.entries.length;
  },

  // Clear all entries (호출 전 스냅샷 저장)
  clearAllEntries() {
    this.saveSnapshot('전체 초기화');
    this.saveAllEntries([]);
  },

  // Get entry for today (YYYY-MM-DD in local time)
  getTodayEntry() {
    const todayStr = getLocalDateString();
    return this.getEntries().find(e => e.date === todayStr) || null;
  },

  // Save or update an entry (하루에 한 개 기록)
  saveEntry(entry) {
    const raw = this.readRawEntries();
    const now = new Date().toISOString();

    let idx = -1;
    if (entry.id) idx = raw.findIndex(e => e && e.id === entry.id);
    if (idx < 0) idx = raw.findIndex(e => e && e.date === entry.date);

    if (!entry.id) {
      entry.id = idx >= 0 && raw[idx].id ? raw[idx].id : 'entry_' + Date.now();
    }
    entry.updatedAt = now;

    let next;
    if (idx >= 0) {
      const merged = { ...raw[idx], ...entry };
      next = raw.slice();
      next[idx] = merged;
      // 날짜를 바꿔 저장한 경우, 같은 날짜의 다른 기록은 덮어쓴다 (하루 1기록 유지)
      next = next.filter((e, i) => i === idx || !e || e.date !== merged.date);
    } else {
      entry.createdAt = now;
      next = [...raw, entry];
    }

    this.saveAllEntries(next);
    this.triggerSyncIfConfigured();
    return entry;
  },

  // Delete an entry by ID or date (YYYY-MM-DD)
  deleteEntry(idOrDate) {
    if (!idOrDate) return;
    const byDate = isDateKey(idOrDate);
    const raw = this.readRawEntries();
    const next = raw.filter(e => !(e && (byDate ? e.date === idOrDate : e.id === idOrDate)));
    if (next.length === raw.length) return;
    this.saveAllEntries(next);
  },

  // Save array of entries across LocalStorage, Backup & IndexedDB
  saveAllEntries(entries) {
    sortEntriesDesc(entries);
    const jsonStr = JSON.stringify(entries);

    // 1. Primary LocalStorage
    lsSet(STORAGE_KEYS.ENTRIES, jsonStr);
    // 2. Secondary LocalStorage Backup
    lsSet(STORAGE_KEYS.BACKUP, jsonStr);

    // 3. Tertiary IndexedDB
    idbSet('entries', entries);

    // 4. If running local backend server, sync to data/entries.json
    if (this.isLocalServer()) {
      fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr
      }).catch(() => {});
    }
  },

  isLocalServer() {
    try {
      const h = window.location.hostname;
      return h === 'localhost' || h === '127.0.0.1';
    } catch (_) {
      return false;
    }
  },

  // Asynchronous storage initialization & deep recovery
  async initStorage() {
    // 브라우저가 저장공간을 임의로 정리하지 않도록 영구 저장 요청 (지원 브라우저만)
    try {
      if (navigator.storage && navigator.storage.persist) {
        const persisted = await navigator.storage.persisted();
        if (!persisted) await navigator.storage.persist();
      }
    } catch (_) {}

    const localRaw = lsGet(STORAGE_KEYS.ENTRIES);
    let entries = this.readRawEntries();
    const idbEntries = await idbGet('entries');

    if (entries.length === 0 && Array.isArray(idbEntries) && idbEntries.length > 0) {
      // LocalStorage가 비었는데 IndexedDB에 사본이 있으면 복구 (초기화 버튼은 IndexedDB도 함께 비움)
      this.saveAllEntries(idbEntries);
      entries = idbEntries;
      console.log('Recovered entries from IndexedDB');
    } else if (entries.length > 0 && !(Array.isArray(idbEntries) && idbEntries.length > 0)) {
      // 예전 버전 사용자: IndexedDB 사본이 없으면 지금 채워 둔다
      await idbSet('entries', entries);
    }

    // 프로필 / 클라우드 설정도 IndexedDB 사본과 상호 복구
    await this.syncSettingWithIDB(STORAGE_KEYS.PROFILE, 'profile');
    await this.syncSettingWithIDB(STORAGE_KEYS.CLOUD, 'cloud');

    // 로컬 개발 서버에서만 data/entries.json 사용 (배포 사이트에서는 다른 사람 데이터가 섞이지 않도록 사용 안 함)
    if (entries.length === 0 && localRaw === null && this.isLocalServer()) {
      try {
        const res = await fetch('/api/entries', { cache: 'no-store' });
        if (res.ok) {
          const serverData = await res.json();
          if (Array.isArray(serverData) && serverData.length > 0) {
            this.saveAllEntries(serverData);
            entries = serverData;
          }
        }
      } catch (_) {}
    }

    return this.getEntries();
  },

  async syncSettingWithIDB(lsKey, idbKey) {
    const local = lsGet(lsKey);
    const fromIdb = await idbGet(idbKey);
    if (!local && fromIdb && typeof fromIdb === 'object') {
      lsSet(lsKey, JSON.stringify(fromIdb));
    } else if (local && !fromIdb) {
      try {
        await idbSet(idbKey, JSON.parse(local));
      } catch (_) {}
    }
  },

  // Get user profile
  getProfile() {
    try {
      const raw = lsGet(STORAGE_KEYS.PROFILE);
      return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : { ...DEFAULT_PROFILE };
    } catch (e) {
      return { ...DEFAULT_PROFILE };
    }
  },

  // Save user profile (기존 필드는 유지)
  saveProfile(profile) {
    const merged = { ...this.getProfile(), ...profile };
    lsSet(STORAGE_KEYS.PROFILE, JSON.stringify(merged));
    idbSet('profile', merged);
  },

  // Cloud configuration (Google Sheets API etc.)
  getCloudConfig() {
    try {
      const raw = lsGet(STORAGE_KEYS.CLOUD);
      return raw ? JSON.parse(raw) : { googleSheetUrl: '', autoSync: false, lastSyncedAt: null };
    } catch (e) {
      return { googleSheetUrl: '', autoSync: false, lastSyncedAt: null };
    }
  },

  saveCloudConfig(config) {
    lsSet(STORAGE_KEYS.CLOUD, JSON.stringify(config));
    idbSet('cloud', config);
  },

  // Pull latest entries from Google Sheets Web App
  async pullFromGoogleSheets() {
    const config = this.getCloudConfig();
    if (!config.googleSheetUrl || !config.googleSheetUrl.startsWith('https://script.google.com')) {
      return null;
    }

    try {
      const response = await fetch(config.googleSheetUrl, { method: 'GET' });
      const result = await response.json();
      if (result && result.status === 'success' && Array.isArray(result.entries)) {
        const raw = this.readRawEntries();
        const localDates = new Set(raw.map(e => e && e.date));
        // Merge: 로컬 기록 우선, 시트에는 있고 로컬에 없는 날짜만 추가
        const additions = result.entries
          .map(normalizeEntry)
          .filter(e => e && !localDates.has(e.date));
        if (additions.length > 0) {
          this.saveAllEntries([...raw, ...additions]);
        }
        config.lastSyncedAt = new Date().toISOString();
        this.saveCloudConfig(config);
        return { success: true, added: additions.length };
      }
    } catch (err) {
      console.warn('Google Sheets pull error:', err);
    }
    return null;
  },

  // Push local data to Google Sheets Apps Script Web App
  async syncWithGoogleSheets() {
    const config = this.getCloudConfig();
    if (!config.googleSheetUrl || !config.googleSheetUrl.startsWith('https://script.google.com')) {
      throw new Error('올바른 구글 앱스 스크립트 웹 앱 URL을 입력해주세요.');
    }

    const localEntries = this.getEntries();
    const profile = this.getProfile();

    const response = await fetch(config.googleSheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'sync',
        profile: profile,
        entries: localEntries
      })
    });

    const result = await response.json();
    if (result && result.status === 'success') {
      config.lastSyncedAt = new Date().toISOString();
      this.saveCloudConfig(config);
      return { success: true, count: localEntries.length, serverMessage: result.message };
    }
    throw new Error(result?.message || '동기화 응답이 올바르지 않습니다.');
  },

  async triggerSyncIfConfigured() {
    const config = this.getCloudConfig();
    if (config.googleSheetUrl && config.autoSync) {
      try {
        await this.syncWithGoogleSheets();
      } catch (e) {
        console.warn('Background auto sync skipped:', e.message);
      }
    }
  },

  // Generate 35 days of realistic weight loss journey
  generateSampleData() {
    const samples = [];
    const today = new Date();
    const startWeight = 74.8;

    let current = startWeight;
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = getLocalDateString(d);

      const slope = -0.075;
      const noise = (Math.random() - 0.45) * 0.4;
      current = +(current + slope + noise).toFixed(2);

      const bodyFat = +(22.5 - ((startWeight - current) * 0.7) + (Math.random() * 0.4 - 0.2)).toFixed(2);
      const muscle = +(31.2 + ((startWeight - current) * 0.1) + (Math.random() * 0.2 - 0.1)).toFixed(2);

      const notes = [
        '아침 공복 측정',
        '저녁 헬스 후 가벼운 컨디션',
        '유산소 40분 완료 🏃',
        '치팅 데이 다음날 붓기 있음',
        '물 2L 마시기 성공',
        '근력 운동 1시간 & 단백질 식단',
        '충분한 수면 (7시간 반)',
        ''
      ];
      const note = i % 4 === 0 ? notes[Math.floor(Math.random() * notes.length)] : '';

      samples.push({
        id: 'sample_' + i,
        date: dateStr,
        time: i % 3 === 0 ? '07:30' : '08:00',
        weight: current,
        bodyFat: bodyFat > 0 ? bodyFat : null,
        muscleMass: muscle > 0 ? muscle : null,
        timeOfDay: 'morning',
        mood: 4 + (Math.random() > 0.5 ? 1 : 0),
        note: note,
        tags: current < startWeight - 2 ? ['목표근접'] : []
      });
    }

    return samples;
  },

  // 샘플 데이터는 기록이 하나도 없을 때만 로드 (실제 기록과 섞이거나 덮어쓰지 않도록)
  loadSampleData() {
    if (this.readRawEntries().length > 0) {
      throw new Error('이미 기록이 있어 샘플 데이터를 불러올 수 없습니다. (내 기록 보호)');
    }
    const samples = this.generateSampleData();
    this.saveAllEntries(samples);
    return samples.length;
  },

  // Export CSV
  exportCSV() {
    const entries = this.getEntries();
    let csv = '날짜,시간,체중(kg),체지방률(%),골격근량(kg),측정시간대,메모\n';
    entries.forEach(e => {
      const row = [
        e.date,
        e.time || '',
        e.weight,
        e.bodyFat ?? '',
        e.muscleMass ?? '',
        e.timeOfDay === 'evening' ? '저녁' : '아침 공복',
        `"${(e.note || '').replace(/"/g, '""')}"`
      ];
      csv += row.join(',') + '\n';
    });
    return csv;
  },

  // Export JSON (원본 그대로 백업)
  exportJSON() {
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      profile: this.getProfile(),
      entries: this.readRawEntries()
    }, null, 2);
  },

  // Import JSON: 기존 기록은 지우지 않고 병합 (같은 날짜는 백업 파일 값으로 교체)
  importJSON(jsonString) {
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (_) {
      throw new Error('JSON 파일을 읽을 수 없습니다.');
    }
    const incoming = Array.isArray(data) ? data : data?.entries;
    if (!Array.isArray(incoming)) {
      throw new Error('유효한 체중 데이터 형식이 아닙니다.');
    }
    const valid = incoming.map(normalizeEntry).filter(Boolean);
    if (valid.length === 0) {
      throw new Error('백업 파일에 복원할 기록이 없습니다.');
    }

    this.saveSnapshot('백업 복원');
    const incomingDates = new Set(valid.map(e => e.date));
    const kept = this.readRawEntries().filter(e => !(e && incomingDates.has(e.date)));
    this.saveAllEntries([...kept, ...valid]);

    if (data && !Array.isArray(data) && data.profile && typeof data.profile === 'object') {
      this.saveProfile(data.profile);
    }
    return valid.length;
  }
};
