/**
 * storage.js - Local & Cloud Storage Engine for Weight Tracker
 */

const STORAGE_KEYS = {
  ENTRIES: 'weight_tracker_entries',
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

// Automatically reset all previous sample data to 0 as requested by user
const RESET_FLAG_KEY = 'weight_tracker_zeroed_v1';
if (!localStorage.getItem(RESET_FLAG_KEY)) {
  localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]));
  localStorage.setItem(RESET_FLAG_KEY, 'true');
}

export const Storage = {
  // Get all weight entries, sorted descending by date
  getEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ENTRIES);
      if (!raw) {
        localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]));
        return [];
      }
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.sort((a, b) => new Date(b.date + 'T' + (b.time || '12:00')) - new Date(a.date + 'T' + (a.time || '12:00')));
    } catch (e) {
      console.error('Failed to load entries from localStorage', e);
      return [];
    }
  },

  // Clear all entries to 0
  clearAllEntries() {
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify([]));
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

  // Delete an entry
  deleteEntry(id) {
    const entries = this.getEntries().filter(e => e.id !== id);
    this.saveAllEntries(entries);
  },

  // Save array of entries directly
  saveAllEntries(entries) {
    entries.sort((a, b) => new Date(b.date + 'T' + (b.time || '12:00')) - new Date(a.date + 'T' + (a.time || '12:00')));
    localStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify(entries));
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

  // Sync with Google Sheets Apps Script Web App
  async syncWithGoogleSheets() {
    const config = this.getCloudConfig();
    if (!config.googleSheetUrl || !config.googleSheetUrl.startsWith('https://script.google.com')) {
      throw new Error('올바른 구글 앱스 스크립트 웹 앱 URL을 입력해주세요.');
    }

    const localEntries = this.getEntries();
    const profile = this.getProfile();

    try {
      // POST data to Google Apps Script
      const response = await fetch(config.googleSheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight issues with Google Apps Script
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
    const targetWeight = 68.0;

    let current = startWeight;
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      // Realistic daily fluctuation (-0.4 to +0.25 kg, with net downward slope)
      const slope = -0.075;
      const noise = (Math.random() - 0.45) * 0.4;
      current = +(current + slope + noise).toFixed(1);

      // Estimate body fat % (around 22% -> 19.5%)
      const bodyFat = +(22.5 - ((startWeight - current) * 0.7) + (Math.random() * 0.4 - 0.2)).toFixed(1);
      // Estimate muscle mass
      const muscle = +(31.2 + ((startWeight - current) * 0.1) + (Math.random() * 0.2 - 0.1)).toFixed(1);

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
