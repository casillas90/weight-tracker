/**
 * app.js - Main Application Controller for Weight Tracker & Analytics
 */

import { Storage } from './storage.js';
import { Analytics } from './analytics.js';
import { Charts } from './charts.js';

let currentFilter = '30D';
let currentCalendarDate = new Date();
let editingEntryId = null;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initEventListeners();
  refreshApp();
});

// ==========================================================================
// Theme Management
// ==========================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('weight_tracker_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('weight_tracker_theme', next);
  updateThemeIcon(next);
  refreshCharts();
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.innerHTML = theme === 'light' ? '🌙' : '☀️';
    btn.setAttribute('title', theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환');
  }
}

// ==========================================================================
// Event Listeners & UI Binding
// ==========================================================================
function initEventListeners() {
  // Theme Toggle
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

  // Tabs Navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = e.currentTarget.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Time Filter Buttons
  document.querySelectorAll('.filter-pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pill-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentFilter = e.currentTarget.getAttribute('data-filter');
      refreshCharts();
    });
  });

  // Open Record Modal Buttons
  document.getElementById('btnOpenRecordModal')?.addEventListener('click', () => openRecordModal());
  document.getElementById('fabRecordBtn')?.addEventListener('click', () => openRecordModal());
  document.getElementById('btnCloseRecordModal')?.addEventListener('click', closeRecordModal);
  document.getElementById('recordModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'recordModalBackdrop') closeRecordModal();
  });

  // Record Form Stepper Buttons
  const weightInput = document.getElementById('recordWeightInput');
  document.querySelectorAll('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const step = parseFloat(e.currentTarget.getAttribute('data-step') || '0');
      let val = parseFloat(weightInput.value) || 70.0;
      val = +(val + step).toFixed(1);
      if (val > 20 && val < 300) {
        weightInput.value = val.toFixed(1);
      }
    });
  });

  // Record Form Submit
  document.getElementById('recordForm')?.addEventListener('submit', handleRecordSubmit);

  // Calendar Month Nav
  document.getElementById('btnCalPrev')?.addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('btnCalNext')?.addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById('btnCalToday')?.addEventListener('click', () => {
    currentCalendarDate = new Date();
    renderCalendar();
  });

  // Profile Form Submit
  document.getElementById('profileForm')?.addEventListener('submit', handleProfileSubmit);

  // Cloud Sync Form Submit
  document.getElementById('cloudConfigForm')?.addEventListener('submit', handleCloudConfigSubmit);
  document.getElementById('btnSyncNow')?.addEventListener('click', handleManualSync);

  // Export / Import Buttons
  document.getElementById('btnExportCSV')?.addEventListener('click', exportCSVFile);
  document.getElementById('btnExportJSON')?.addEventListener('click', exportJSONFile);
  document.getElementById('jsonFileInput')?.addEventListener('change', handleJSONImport);
  document.getElementById('btnLoadSampleData')?.addEventListener('click', () => {
    if (confirm('30일치 시연용 샘플 데이터를 다시 불러오시겠습니까? (기존 데이터에 추가됩니다)')) {
      const samples = Storage.generateSampleData();
      Storage.saveAllEntries(samples);
      refreshApp();
      alert('샘플 데이터가 성공적으로 로드되었습니다!');
    }
  });
  document.getElementById('btnClearAllData')?.addEventListener('click', () => {
    if (confirm('정말로 모든 체중 기록을 0으로 초기화하시겠습니까? (삭제된 데이터는 복구할 수 없습니다)')) {
      Storage.clearAllEntries();
      refreshApp();
      alert('모든 기록이 0으로 초기화되었습니다. 지금부터 새로운 기록을 시작해보세요! 🚀');
    }
  });

  // Share / QR Modal
  document.getElementById('btnOpenShareModal')?.addEventListener('click', openShareModal);
  document.getElementById('btnCloseShareModal')?.addEventListener('click', closeShareModal);
  document.getElementById('shareModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'shareModalBackdrop') closeShareModal();
  });
  document.getElementById('btnCopyShareUrl')?.addEventListener('click', () => copyShareUrl('shareUrlInput'));
  document.getElementById('btnModalCopyShareUrl')?.addEventListener('click', () => copyShareUrl('modalShareUrlInput'));

  // Tag click toggles
  document.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('selected');
    });
  });
}

// ==========================================================================
// Tabs Routing
// ==========================================================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabId}`);
  });

  if (tabId === 'calendar') {
    renderCalendar();
    renderTable();
  } else if (tabId === 'analytics') {
    refreshCharts();
  } else if (tabId === 'goals') {
    loadProfileIntoForm();
  } else if (tabId === 'sync') {
    loadCloudConfigIntoForm();
    generateQR();
  }
}

// ==========================================================================
// Data Refresh & Hero Cards
// ==========================================================================
export function refreshApp() {
  const entries = Storage.getEntries();
  const profile = Storage.getProfile();

  renderHeroStats(entries, profile);
  renderInsights(entries, profile);
  refreshCharts();
  renderCalendar();
  renderTable();
  updateCloudBadge();
}

function renderHeroStats(entries, profile) {
  const metrics = Analytics.getOverviewMetrics(entries, profile);

  const curEl = document.getElementById('statCurrentWeight');
  const deltaEl = document.getElementById('statDayDelta');
  const deltaPill = document.getElementById('statDayDeltaPill');
  const maEl = document.getElementById('statMovingAvg');
  const targetEl = document.getElementById('statTargetWeight');
  const remainEl = document.getElementById('statRemainWeight');
  const progBar = document.getElementById('statProgressBar');
  const progText = document.getElementById('statProgressText');
  const bmiValEl = document.getElementById('statBmiVal');
  const bmiBadgeEl = document.getElementById('statBmiBadge');
  const streakBadge = document.getElementById('headerStreakBadge');

  if (!metrics || entries.length === 0) {
    if (curEl) curEl.textContent = '0.0';
    if (deltaEl) deltaEl.textContent = '— 0.0 kg';
    if (deltaPill) {
      deltaPill.className = 'stat-delta-pill neutral';
      deltaPill.innerHTML = '— 0.0kg';
    }
    if (maEl) maEl.textContent = '0.0';
    if (targetEl) targetEl.textContent = `${profile.targetWeight || 68.0}kg`;
    if (remainEl) remainEl.textContent = `${profile.targetWeight || 68.0}`;
    if (progBar) progBar.style.width = '0%';
    if (progText) progText.textContent = '오늘 첫 기록을 남겨보세요!';
    if (bmiValEl) bmiValEl.textContent = '0.0';
    if (bmiBadgeEl) {
      bmiBadgeEl.textContent = '기록 대기';
      bmiBadgeEl.className = 'stat-delta-pill neutral';
    }
    if (streakBadge) streakBadge.textContent = '🔥 0일';
    return;
  }

  // 1. Current Weight
  if (curEl) curEl.textContent = metrics.currentWeight.toFixed(1);

  // 2. Day Delta Pill
  if (deltaEl && deltaPill) {
    const d = metrics.dayDelta;
    deltaEl.textContent = `${d > 0 ? '+' : ''}${d.toFixed(1)} kg`;
    deltaPill.className = `stat-delta-pill ${d < 0 ? 'down' : (d > 0 ? 'up' : 'neutral')}`;
    const icon = d < 0 ? '▼' : (d > 0 ? '▲' : '—');
    deltaPill.innerHTML = `${icon} ${d > 0 ? '+' : ''}${d.toFixed(1)}kg`;
  }

  // 3. 7-Day Moving Average
  if (maEl) maEl.textContent = metrics.avg7Days.toFixed(1);

  // 4. Target Remaining & Progress Bar
  if (targetEl) targetEl.textContent = `${profile.targetWeight}kg`;
  if (remainEl) remainEl.textContent = `${metrics.remainingKg}`;
  if (progBar) progBar.style.width = `${metrics.progressPercent}%`;
  if (progText) progText.textContent = `목표 달성률 ${metrics.progressPercent}%`;

  // 5. BMI Info
  if (metrics.bmiInfo) {
    if (bmiValEl) bmiValEl.textContent = metrics.bmiInfo.bmi;
    if (bmiBadgeEl) {
      bmiBadgeEl.textContent = metrics.bmiInfo.status;
      bmiBadgeEl.className = `stat-delta-pill ${metrics.bmiInfo.badgeClass}`;
    }
  }

  // Header Streak Badge
  if (streakBadge) {
    streakBadge.textContent = `🔥 ${metrics.streak}일`;
  }
}

function renderInsights(entries, profile) {
  const metrics = Analytics.getOverviewMetrics(entries, profile);
  const projEl = document.getElementById('insightProjectionText');
  const rateEl = document.getElementById('insightRateText');
  const totalDeltaEl = document.getElementById('insightTotalDelta');

  if (!metrics || entries.length === 0) {
    if (projEl) projEl.innerHTML = '오늘의 첫 체중을 기록하시면 분석 및 목표일 예측이 시작됩니다.';
    if (rateEl) rateEl.innerHTML = '매일 아침 공복에 측정하면 가장 정확한 체지방 추세를 파악할 수 있습니다.';
    if (totalDeltaEl) totalDeltaEl.innerHTML = '새로운 체중 관리 여정을 응원합니다! 🚀';
    return;
  }

  if (projEl) {
    projEl.innerHTML = metrics.projection.message;
  }

  if (rateEl) {
    if (metrics.projection.weeklyRate) {
      const rate = metrics.projection.weeklyRate;
      rateEl.innerHTML = `최근 2주간 주당 평균 <strong>${rate > 0 ? '+' : ''}${rate}kg</strong> 페이스로 순항 중입니다.`;
    } else {
      rateEl.innerHTML = `꾸준한 아침 공복 체중 측정이 건강한 감량 습관의 시작입니다.`;
    }
  }

  if (totalDeltaEl) {
    const t = metrics.totalDelta;
    totalDeltaEl.innerHTML = `시작일 대비 총 <strong>${t > 0 ? '+' : ''}${t}kg</strong> 변화 (${entries.length}일간의 여정)`;
  }
}

function refreshCharts() {
  const entries = Storage.getEntries();
  const profile = Storage.getProfile();
  Charts.renderTrendChart('trendChartCanvas', entries, profile, currentFilter);
  Charts.renderWeeklyDeltaChart('weeklyDeltaCanvas', entries);
  Charts.renderCompositionChart('compositionCanvas', entries);
}

// ==========================================================================
// Calendar View Rendering
// ==========================================================================
function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const title = document.getElementById('calendarMonthTitle');
  if (!grid || !title) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  title.textContent = `${year}년 ${month + 1}월`;

  const entries = Storage.getEntries();
  const entryMap = {};
  entries.forEach(e => {
    entryMap[e.date] = e;
  });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Start from Sunday
  const startDayOfWeek = firstDay.getDay(); // 0: Sun, 1: Mon...
  const totalDays = lastDay.getDate();

  grid.innerHTML = '';

  // Weekday Headers
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  weekdays.forEach(wd => {
    const h = document.createElement('div');
    h.className = 'calendar-weekday';
    h.textContent = wd;
    grid.appendChild(h);
  });

  // Empty cells for previous month days
  for (let i = 0; i < startDayOfWeek; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell other-month';
    grid.appendChild(cell);
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    if (dateStr === todayStr) cell.classList.add('today');

    const dayNum = document.createElement('span');
    dayNum.className = 'cal-day-num';
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    const entry = entryMap[dateStr];
    if (entry) {
      cell.classList.add('has-data');
      const wVal = document.createElement('span');
      wVal.className = 'cal-weight-val num-font';
      wVal.textContent = `${entry.weight}`;
      cell.appendChild(wVal);

      if (entry.note) {
        cell.setAttribute('title', `${entry.weight}kg (${entry.note})`);
      }
    }

    cell.addEventListener('click', () => {
      openRecordModal(dateStr, entry);
    });

    grid.appendChild(cell);
  }
}

// ==========================================================================
// Log History Table Rendering
// ==========================================================================
function renderTable() {
  const tbody = document.getElementById('entriesTableBody');
  if (!tbody) return;

  const entries = Storage.getEntries();
  tbody.innerHTML = '';

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">기록된 체중 데이터가 없습니다. 상단의 [+ 오늘 체중 기록하기]를 눌러보세요!</td></tr>`;
    return;
  }

  // Sorted latest first
  entries.forEach((e, idx) => {
    const tr = document.createElement('tr');

    const nextEntry = entries[idx + 1];
    let deltaHtml = '—';
    if (nextEntry) {
      const diff = +(e.weight - nextEntry.weight).toFixed(1);
      const cls = diff < 0 ? 'down' : (diff > 0 ? 'up' : 'neutral');
      const arrow = diff < 0 ? '▼' : (diff > 0 ? '▲' : '');
      deltaHtml = `<span class="stat-delta-pill ${cls}">${arrow} ${diff > 0 ? '+' : ''}${diff}kg</span>`;
    }

    tr.innerHTML = `
      <td class="num-font" style="font-weight: 600;">${e.date}</td>
      <td>${e.timeOfDay === 'evening' ? '저녁' : '아침 공복'}</td>
      <td class="num-font" style="font-weight: 800; color: var(--accent-primary); font-size: 1rem;">${e.weight} kg</td>
      <td>${deltaHtml}</td>
      <td class="num-font">${e.bodyFat ? e.bodyFat + '%' : '—'}</td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${e.note || '—'}</td>
      <td class="table-actions">
        <button class="btn-icon" data-edit-id="${e.id}" title="수정" style="width: 32px; height: 32px;">✏️</button>
        <button class="btn-icon" data-delete-id="${e.id}" title="삭제" style="width: 32px; height: 32px;">🗑️</button>
      </td>
    `;

    tr.querySelector(`[data-edit-id="${e.id}"]`).addEventListener('click', () => {
      openRecordModal(e.date, e);
    });

    tr.querySelector(`[data-delete-id="${e.id}"]`).addEventListener('click', () => {
      if (confirm(`${e.date} 기록(${e.weight}kg)을 정말 삭제하시겠습니까?`)) {
        Storage.deleteEntry(e.id);
        refreshApp();
      }
    });

    tbody.appendChild(tr);
  });
}

// ==========================================================================
// Modal Handlers (Record Form)
// ==========================================================================
function openRecordModal(defaultDate = null, existingEntry = null) {
  const modal = document.getElementById('recordModalBackdrop');
  if (!modal) return;

  editingEntryId = existingEntry ? existingEntry.id : null;
  const title = document.getElementById('modalTitle');
  if (title) title.textContent = existingEntry ? '체중 기록 수정' : '오늘 체중 기록';

  const dateInput = document.getElementById('recordDateInput');
  const weightInput = document.getElementById('recordWeightInput');
  const timeOfDaySelect = document.getElementById('recordTimeOfDay');
  const bodyFatInput = document.getElementById('recordBodyFatInput');
  const muscleInput = document.getElementById('recordMuscleInput');
  const noteInput = document.getElementById('recordNoteInput');

  const todayStr = new Date().toISOString().split('T')[0];
  dateInput.value = defaultDate || existingEntry?.date || todayStr;

  if (existingEntry) {
    weightInput.value = existingEntry.weight.toFixed(1);
    timeOfDaySelect.value = existingEntry.timeOfDay || 'morning';
    bodyFatInput.value = existingEntry.bodyFat || '';
    muscleInput.value = existingEntry.muscleMass || '';
    noteInput.value = existingEntry.note || '';
  } else {
    // Default weight from latest entry or profile
    const entries = Storage.getEntries();
    const latest = entries[0];
    const defaultWeight = latest ? latest.weight : Storage.getProfile().initialWeight || 72.0;
    weightInput.value = defaultWeight.toFixed(1);
    timeOfDaySelect.value = 'morning';
    bodyFatInput.value = latest?.bodyFat || '';
    muscleInput.value = latest?.muscleMass || '';
    noteInput.value = '';
  }

  // Clear tags
  document.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('selected'));
  if (existingEntry?.tags) {
    document.querySelectorAll('.tag-chip').forEach(c => {
      if (existingEntry.tags.includes(c.textContent.trim())) {
        c.classList.add('selected');
      }
    });
  }

  modal.classList.add('open');
}

function closeRecordModal() {
  document.getElementById('recordModalBackdrop')?.classList.remove('open');
  editingEntryId = null;
}

function handleRecordSubmit(e) {
  e.preventDefault();
  const date = document.getElementById('recordDateInput').value;
  const weight = parseFloat(document.getElementById('recordWeightInput').value);
  const timeOfDay = document.getElementById('recordTimeOfDay').value;
  const bodyFat = parseFloat(document.getElementById('recordBodyFatInput').value) || null;
  const muscleMass = parseFloat(document.getElementById('recordMuscleInput').value) || null;
  const note = document.getElementById('recordNoteInput').value.trim();

  const selectedTags = Array.from(document.querySelectorAll('.tag-chip.selected')).map(c => c.textContent.trim());

  if (!date || isNaN(weight) || weight <= 0) {
    alert('날짜와 올바른 체중(kg)을 입력해주세요.');
    return;
  }

  const entry = {
    id: editingEntryId || undefined,
    date,
    weight,
    timeOfDay,
    bodyFat,
    muscleMass,
    note,
    tags: selectedTags
  };

  Storage.saveEntry(entry);
  closeRecordModal();
  refreshApp();
}

// ==========================================================================
// Profile Form
// ==========================================================================
function loadProfileIntoForm() {
  const profile = Storage.getProfile();
  document.getElementById('profileHeight').value = profile.height || 175;
  document.getElementById('profileInitialWeight').value = profile.initialWeight || 75.0;
  document.getElementById('profileTargetWeight').value = profile.targetWeight || 68.0;
  document.getElementById('profileTargetDate').value = profile.targetDate || '2026-12-31';
  document.getElementById('profileGender').value = profile.gender || 'male';
}

function handleProfileSubmit(e) {
  e.preventDefault();
  const profile = {
    height: parseFloat(document.getElementById('profileHeight').value) || 175,
    initialWeight: parseFloat(document.getElementById('profileInitialWeight').value) || 75.0,
    targetWeight: parseFloat(document.getElementById('profileTargetWeight').value) || 68.0,
    targetDate: document.getElementById('profileTargetDate').value,
    gender: document.getElementById('profileGender').value
  };

  Storage.saveProfile(profile);
  refreshApp();
  alert('프로필 및 목표가 성공적으로 저장되었습니다! 🎯');
}

// ==========================================================================
// Cloud Sync & Google Sheets Setup
// ==========================================================================
function loadCloudConfigIntoForm() {
  const config = Storage.getCloudConfig();
  document.getElementById('cloudGoogleSheetUrl').value = config.googleSheetUrl || '';
  document.getElementById('cloudAutoSync').checked = !!config.autoSync;

  const statusEl = document.getElementById('syncStatusDesc');
  if (statusEl) {
    if (config.lastSyncedAt) {
      statusEl.textContent = `최근 동기화: ${new Date(config.lastSyncedAt).toLocaleString()}`;
    } else {
      statusEl.textContent = config.googleSheetUrl ? '연결 대기 중' : '로컬 모드 (구글 시트 미연결)';
    }
  }
}

function handleCloudConfigSubmit(e) {
  e.preventDefault();
  const config = {
    googleSheetUrl: document.getElementById('cloudGoogleSheetUrl').value.trim(),
    autoSync: document.getElementById('cloudAutoSync').checked,
    lastSyncedAt: Storage.getCloudConfig().lastSyncedAt
  };
  Storage.saveCloudConfig(config);
  updateCloudBadge();
  alert('클라우드 연동 설정이 저장되었습니다!');
}

async function handleManualSync() {
  const btn = document.getElementById('btnSyncNow');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '동기화 진행 중... ⏳';
  }

  try {
    const res = await Storage.syncWithGoogleSheets();
    alert(`구글 시트 동기화 완료! (${res.count}개 항목 반영) 🎉`);
    loadCloudConfigIntoForm();
    updateCloudBadge();
  } catch (err) {
    alert(`동기화 실패: ${err.message}\n구글 앱스 스크립트 웹 앱 URL 및 권한 설정을 확인해주세요.`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 지금 즉시 시트와 동기화';
    }
  }
}

function updateCloudBadge() {
  const badge = document.getElementById('cloudSyncBadge');
  if (!badge) return;
  const config = Storage.getCloudConfig();
  if (config.googleSheetUrl) {
    badge.classList.add('online');
    badge.querySelector('.sync-text').textContent = '클라우드 연동됨';
  } else {
    badge.classList.remove('online');
    badge.querySelector('.sync-text').textContent = '로컬 저장';
  }
}

// ==========================================================================
// External Share & Dynamic QR Code
// ==========================================================================
function openShareModal() {
  const modal = document.getElementById('shareModalBackdrop');
  if (!modal) return;
  modal.classList.add('open');
  generateQR('shareModalQrContainer', 'modalShareUrlInput');
}

function closeShareModal() {
  document.getElementById('shareModalBackdrop')?.classList.remove('open');
}

async function generateQR(containerId = 'qrcodeContainer', inputId = 'shareUrlInput') {
  const container = document.getElementById(containerId);
  const urlInput = document.getElementById(inputId);
  let targetUrl = window.location.href;

  try {
    const res = await fetch('/tunnel_info.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        targetUrl = data.url;
      }
    }
  } catch (e) {
    // Fallback to current window location
  }

  if (urlInput) urlInput.value = targetUrl;
  if (!container) return;

  container.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(container, {
      text: targetUrl,
      width: 170,
      height: 170,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }
}

function copyShareUrl(inputId = 'shareUrlInput') {
  const urlInput = document.getElementById(inputId);
  if (!urlInput) return;
  urlInput.select();
  navigator.clipboard.writeText(urlInput.value).then(() => {
    alert('접속 링크가 클립보드에 복사되었습니다! 카카오톡이나 메시지로 공유해 보세요.');
  });
}

// ==========================================================================
// Backup & Export / Import
// ==========================================================================
function exportCSVFile() {
  const csv = Storage.exportCSV();
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weight_records_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSONFile() {
  const json = Storage.exportJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `weight_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleJSONImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const count = Storage.importJSON(event.target.result);
      refreshApp();
      alert(`백업 파일에서 ${count}개의 기록을 성공적으로 복원했습니다!`);
    } catch (err) {
      alert(`복원 실패: ${err.message}`);
    }
  };
  reader.readAsText(file);
}
