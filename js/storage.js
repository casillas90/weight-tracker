/**
 * storage.js - Multi-layer Resilient Storage Engine for Weight Tracker
 * Supports LocalStorage + Local Backup + IndexedDB + Google Sheets Cloud Sync
 */

const STORAGE_KEYS = {
  ENTRIES: 'weight_tracker_entries',
  BACKUP: 'weight_tracker_entries_backup',
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

// ==========================================================================
// IndexedDB Helper (Tertiary Storage for Zero Data Loss)
// ==========================================================================
const IDB_NAME = 'FitTrackDB';
const IDB_STORE = 'weight_store';

function openIDB() {
  return new Promise((resolve, reject) => {
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
  });
}

async function idbSet(key, value) {
  try {
    const db = await openIDB();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
  } catch (e) {
    console.warn('IDB write skipped', e);
  }
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

// Safely ensure entries key exists without wiping existing data
try {
  const existing = localStorage.getItem(STORAGE_KEYS.ENTRIES);
  const backup = localStorage.getItem(STORAGE_KEYS.BACKUP);
  if (!existing && backup) {
    // Auto-recover from backup
    localStorage.setItem(STORAGE_KEYS.ENTRIES, backup);
  } else if (!existing) {
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]));
  }
} catch (e) {
  console.warn('LocalStorage init note:', e);
}

export const Storage = {
  // Get all weight entries, sorted descending by date
  getEntries() {
    try {
      let raw = localStorage.getItem(STORAGE_KEYS.ENTRIES);
      if (!raw || raw === '[]') {
        // Attempt recovery from backup key
        const backup = localStorage.getItem(STORAGE_KEYS.BACKUP);
        if (backup && backup !== '[]') {
          raw = backup;
          localStorage.setItem(STORAGE_KEYS.ENTRIES, backup);
        }
      }
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.sort((a, b) => new Date(b.date + 'T' + (b.time || '12:00')) - new Date(a.date + 'T' + (a.time || '12:00')));
    } catch (e) {
      console.error('Failed to load entries from localStorage', e);
      return [];
    }
  },

  // Clear all entries
  clearAllEntries() {
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.BACKUP, JSON.stringify([]));
    idbSet('entries', []);
  },

  // Get entry for today (YYYY-MM-DD)
  getTodayEntry() {
    const todayStr = new Date().toISOString().split('T')[0];
    const entries = this.getEntries();
    return entries.find(e => e.date === todayStr) || null;
  },

  // Delete today's entry
  deleteTodayEntry() {
    const todayStr = new Date().toISOString().split('T')[0];
    const entries = this.getEntries();
    const target = entries.find(e => e.date === todayStr);
    if (target) {
      this.deleteEntry(target.id);
      return target;
    }
    return null;
  },

  // Save or update an entry
  saveEntry(entry) {
    const entries = this.getEntries();
    const existingIndex = entries.findIndex(e => e.id === entry.id || e.date === entry.date);

    if (!entry.id) {
      entry.id = 'entry_' + Date.now();
    }
    entry.updatedAt = new Date().toISOString();

    if (existingIndex >= 0) {
      entries[existingIndex] = { ...entries[existingIndex], ...entry };
    } else {
      entries.push(entry);
    }

    this.saveAllEntries(entries);
    this.triggerSyncIfConfigured(entry);
    return entry;
  },

  // Delete an entry by ID or date
  deleteEntry(idOrDate) {
    const entries = this.getEntries().filter(e => e.id !== idOrDate && e.date !== idOrDate);
    this.saveAllEntries(entries);
  },

  // Save array of entries across LocalStorage, Backup & IndexedDB
  saveAllEntries(entries) {
    entries.sort((a, b) => new Date(b.date + 'T' + (b.time || '12:00')) - new Date(a.date + 'T' + (a.time || '12:00')));
    const jsonStr = JSON.stringify(entries);

    // 1. Primary LocalStorage
    try {
      localStorage.setItem(STORAGE_KEYS.ENTRIES, jsonStr);
      // 2. Secondary LocalStorage Backup
      localStorage.setItem(STORAGE_KEYS.BACKUP, jsonStr);
    } catch (e) {
      console.warn('LocalStorage quota or access warning:', e);
    }

    // 3. Tertiary IndexedDB
    idbSet('entries', entries);

    // 4. If running local backend server, sync to data/entries.json
    try {
      if (window.location.protocol.startsWith('http')) {
        fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonStr
        }).catch(() => {});
      }
    } catch (_) {}
  },

  // Asynchronous storage initialization & deep recovery
  async initStorage() {
    let entries = this.getEntries();

    // If local is empty, try restoring from IndexedDB
    if (entries.length === 0) {
      const idbEntries = await idbGet('entries');
      if (Array.isArray(idbEntries) && idbEntries.length > 0) {
        this.saveAllEntries(idbEntries);
        entries = idbEntries;
        console.log('Successfully recovered entries from IndexedDB');
      }
    }

    // If still empty, check static bundled data/entries.json (for deployed site persistence)
    if (entries.length === 0) {
      try {
        const res = await fetch('data/entries.json');
        if (res.ok) {
          const staticData = await res.json();
          if (Array.isArray(staticData) && staticData.length > 0) {
            this.saveAllEntries(staticData);
            entries = staticData;
            console.log('Loaded initial deployment entries from data/entries.json');
          }
        }
      } catch (_) {}
    }

    // Cloud auto-sync pull if configured
    const config = this.getCloudConfig();
    if (config.googleSheetUrl && config.autoSync) {
      try {
        await this.pullFromGoogleSheets();
      } catch (e) {
        console.warn('Initial cloud pull skipped:', e.message);
      }
    }

    return entries;
  },

  // Get user profile
  getProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFILE);
      return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : { ...DEFAULT_PROFILE };
    } catch (e) {
      return { ...DEFAULT_PROFILE };
    }
  },

  // Save user profile
  saveProfile(profile) {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
    idbSet('profile', profile);
  },

  // Cloud configuration (Google Sheets API etc.)
  getCloudConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CLOUD);
      return raw ? JSON.parse(raw) : { googleSheetUrl: '', autoSync: false, lastSyncedAt: null };
    } catch (e) {
      return { googleSheetUrl: '', autoSync: false, lastSyncedAt: null };
    }
  },

  saveCloudConfig(config) {
    localStorage.setItem(STORAGE_KEYS.CLOUD, JSON.stringify(config));
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
        const localEntries = this.getEntries();
        const map = new Map();
        // Merge: local entries prioritized, sheets fills gaps
        result.entries.forEach(e => map.set(e.date, e));
        localEntries.forEach(e => map.set(e.date, e));
        const merged = Array.from(map.values());
        this.saveAllEntries(merged);
        config.lastSyncedAt = new Date().toISOString();
        this.saveCloudConfig(config);
        return { success: true, count: merged.length };
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

    try {
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
      } else {
        throw new Error(result?.message || '동기화 응답이 올바르지 않습니다.');
      }
    } catch (err) {
      console.error('Cloud sync error:', err);
      throw err;
    }
  },

  async triggerSyncIfConfigured(entry) {
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
      const dateStr = d.toISOString().split('T')[0];

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

  // Export CSV
  exportCSV() {
    const entries = this.getEntries();
    let csv = '날짜,시간,체중(kg),체지방률(%),골격근량(kg),측정시간대,메모\n';
    entries.forEach(e => {
      const row = [
        e.date,
        e.time || '',
        e.weight,
        e.bodyFat || '',
        e.muscleMass || '',
        e.timeOfDay || 'morning',
        `"${(e.note || '').replace(/"/g, '""')}"`
      ];
      csv += row.join(',') + '\n';
    });
    return csv;
  },

  // Export JSON
  exportJSON() {
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      profile: this.getProfile(),
      entries: this.getEntries()
    }, null, 2);
  },

  // Import JSON
  importJSON(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data.entries || !Array.isArray(data.entries)) {
      throw new Error('유효한 체중 데이터 형식이 아닙니다.');
    }
    if (data.profile) {
      this.saveProfile(data.profile);
    }
    this.saveAllEntries(data.entries);
    return data.entries.length;
  }
};
