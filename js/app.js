/**
 * app.js - Main Application Controller for Weight Tracker & Analytics
 */

import { Storage, getLocalDateString, parseLocalDate } from './storage.js?v=20261012_3';
import { Analytics } from './analytics.js?v=20261012_3';
import { Charts } from './charts.js?v=20261012_3';

let currentFilter = '30D';
let currentCalendarDate = new Date();
let editingEntryId = null;
const CURRENT_APP_VERSION = '20261012_3';

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initEventListeners();
  // 저장된 기록으로 즉시 그린 뒤, 복구/동기화가 끝나면 다시 그린다
  refreshApp();
  try {
    await Storage.initStorage();
  } catch (e) {
    console.warn('Storage init failed', e);
  }
  refreshApp();
  checkForUpdates();

  const config = Storage.getCloudConfig();
  if (config.googleSheetUrl && config.autoSync) {
    Storage.pullFromGoogleSheets().then(res => {
      if (res && res.added > 0) refreshApp();
    });
  }
});

// ==========================================================================
// Helpers
// ==========================================================================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function signed(n, digits = 2) {
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function formatDateKo(dateStr) {
  const d = parseLocalDate(dateStr);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${wd})`;
}

let toastTimer = null;
function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ==========================================================================
// Theme Management
// ==========================================================================
const SUN_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function initTheme() {
  let savedTheme = 'dark';
  try {
    savedTheme = localStorage.getItem('weight_tracker_theme') || 'dark';
  } catch (_) {}
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#0c0d10');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.innerHTML = theme === 'light' ? MOON_ICON : SUN_ICON;
    btn.setAttribute('title', theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem('weight_tracker_theme', next);
  } catch (_) {}
  applyTheme(next);
  refreshCharts();
}

// ==========================================================================
// iOS Home Screen PWA & Auto Update Management
// ==========================================================================
function reloadAppForcefully() {
  document.getElementById('btnAppReload')?.classList.add('spinning');
  const url = new URL(window.location.href);
  url.searchParams.set('t', Date.now().toString());
  window.location.href = url.toString();
}

async function checkForUpdates() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.version && data.version !== CURRENT_APP_VERSION) {
        const banner = document.getElementById('updateBanner');
        if (banner) banner.hidden = false;
      }
    }
  } catch (_) {}
}

// ==========================================================================
// Event Listeners & UI Binding
// ==========================================================================
function initEventListeners() {
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('btnAppReload')?.addEventListener('click', reloadAppForcefully);
  document.getElementById('btnApplyUpdate')?.addEventListener('click', reloadAppForcefully);

  // Tabs Navigation (상단 탭 + 하단 탭바 공용)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      switchTab(e.currentTarget.getAttribute('data-tab'));
      if (e.currentTarget.closest('.bottom-nav')) window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Record Modal
  document.getElementById('btnOpenRecordModal')?.addEventListener('click', () => openRecordModal());
  document.getElementById('fabRecordBtn')?.addEventListener('click', () => openRecordModal());
  document.getElementById('btnCloseRecordModal')?.addEventListener('click', closeRecordModal);
  document.getElementById('recordModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'recordModalBackdrop') closeRecordModal();
  });

  // Weight stepper
  const weightInput = document.getElementById('recordWeightInput');
  document.querySelectorAll('.stepper-btn[data-step]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const step = parseFloat(e.currentTarget.getAttribute('data-step') || '0');
      const base = parseFloat(weightInput.value);
      const val = +((Number.isFinite(base) ? base : 70) + step).toFixed(2);
      if (val >= 20 && val <= 400) {
        weightInput.value = val.toFixed(2);
      }
    });
  });

  document.getElementById('recordForm')?.addEventListener('submit', handleRecordSubmit);

  // Calendar Month Nav
  document.getElementById('btnCalPrev')?.addEventListener('click', () => {
    currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('btnCalNext')?.addEventListener('click', () => {
    currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('btnCalToday')?.addEventListener('click', () => {
    currentCalendarDate = new Date();
    renderCalendar();
  });

  // 모달에서 날짜를 바꾸면: 그 날짜 기록이 있으면 불러오고, 없으면 입력값은 유지한 채 새 기록으로 전환
  document.getElementById('recordDateInput')?.addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    const existing = Storage.getEntries().find(item => item.date === selectedDate);
    // 기존 기록을 보던 중이었다면 그 값을 다른 날짜로 옮기지 않도록 기본값으로 초기화
    updateModalFieldsForEntry(selectedDate, existing, { keepValues: !existing && !editingEntryId });
  });

  document.getElementById('profileForm')?.addEventListener('submit', handleProfileSubmit);

  document.getElementById('cloudConfigForm')?.addEventListener('submit', handleCloudConfigSubmit);
  document.getElementById('btnSyncNow')?.addEventListener('click', handleManualSync);

  // Data management
  document.getElementById('btnExportCSV')?.addEventListener('click', exportCSVFile);
  document.getElementById('btnExportJSON')?.addEventListener('click', () => {
    exportJSONFile();
    showToast('백업 파일을 저장했어요.');
  });
  document.getElementById('jsonFileInput')?.addEventListener('change', handleJSONImport);
  document.getElementById('btnRestoreSnapshot')?.addEventListener('click', handleRestoreSnapshot);
  document.getElementById('btnLoadSampleData')?.addEventListener('click', () => {
    try {
      if (Storage.readRawEntries().length > 0) {
        alert('이미 기록이 있어서 샘플 데이터를 불러오지 않았어요. (내 기록 보호)');
        return;
      }
      if (!confirm('35일치 샘플 데이터를 불러올까요?\n나중에 [모든 기록 삭제]로 지울 수 있어요.')) return;
      const count = Storage.loadSampleData();
      refreshApp();
      showToast(`샘플 기록 ${count}개를 불러왔어요.`);
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById('btnClearAllData')?.addEventListener('click', () => {
    const count = Storage.readRawEntries().length;
    if (count === 0) {
      showToast('삭제할 기록이 없어요.');
      return;
    }
    if (!confirm(`기록 ${count}개를 모두 삭제할까요?\n\n삭제 직전 백업 파일이 자동으로 저장되고, 설정 탭의 [직전 상태로 되돌리기]로 복구할 수 있어요.`)) return;
    exportJSONFile();
    Storage.clearAllEntries();
    refreshApp();
    showToast('모든 기록을 삭제했어요. 되돌리기가 가능해요.');
  });

  // Share / QR Modal
  document.getElementById('btnOpenShareModal')?.addEventListener('click', openShareModal);
  document.getElementById('btnCloseShareModal')?.addEventListener('click', closeShareModal);
  document.getElementById('shareModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'shareModalBackdrop') closeShareModal();
  });
  document.getElementById('btnCopyShareUrl')?.addEventListener('click', () => copyShareUrl('shareUrlInput'));
  document.getElementById('btnModalCopyShareUrl')?.addEventListener('click', () => copyShareUrl('modalShareUrlInput'));

  document.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('selected');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeRecordModal();
      closeShareModal();
    }
  });

  // 다른 탭(브라우저 탭)에서 기록이 바뀌면 화면 갱신
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('weight_tracker_')) refreshApp();
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
    renderSnapshotButton();
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
  renderSnapshotButton();
}

function renderHeroStats(entries, profile) {
  const metrics = Analytics.getOverviewMetrics(entries, profile);

  const curEl = document.getElementById('statCurrentWeight');
  const deltaPill = document.getElementById('statDayDeltaPill');
  const lastDateEl = document.getElementById('statLastDate');
  const maEl = document.getElementById('statMovingAvg');
  const targetEl = document.getElementById('statTargetWeight');
  const remainEl = document.getElementById('statRemainWeight');
  const goalDateEl = document.getElementById('statGoalDateText');
  const progBar = document.getElementById('statProgressBar');
  const progText = document.getElementById('statProgressText');
  const bmiValEl = document.getElementById('statBmiVal');
  const bmiBadgeEl = document.getElementById('statBmiBadge');
  const bmiRangeEl = document.getElementById('bmiRangeText');
  const streakBadge = document.getElementById('headerStreakBadge');

  const target = Number(profile.targetWeight) || 68.0;
  if (targetEl) targetEl.textContent = `${fmt(target)}kg`;

  if (goalDateEl) {
    if (profile.targetDate) {
      const days = Math.round((parseLocalDate(profile.targetDate) - parseLocalDate(getLocalDateString())) / 86400000);
      goalDateEl.textContent = days > 0 ? `목표일까지 ${days}일` : (days === 0 ? '오늘이 목표일' : '목표일이 지났어요');
    } else {
      goalDateEl.textContent = '목표일을 설정해 보세요';
    }
  }

  if (!metrics || entries.length === 0) {
    if (curEl) curEl.textContent = '--.--';
    if (deltaPill) {
      deltaPill.className = 'pill neutral';
      deltaPill.textContent = '기록 없음';
    }
    if (lastDateEl) lastDateEl.textContent = '오늘 첫 기록을 남겨보세요';
    if (maEl) maEl.textContent = '--.--';
    if (remainEl) remainEl.textContent = '--.--';
    if (progBar) progBar.style.width = '0%';
    if (progText) progText.textContent = '목표 달성률 0%';
    if (bmiValEl) bmiValEl.textContent = '--.-';
    if (bmiBadgeEl) {
      bmiBadgeEl.textContent = '기록 대기';
      bmiBadgeEl.className = 'pill neutral';
    }
    if (bmiRangeEl) bmiRangeEl.textContent = '';
    if (streakBadge) streakBadge.textContent = '🔥 0일';
    return;
  }

  if (curEl) curEl.textContent = fmt(metrics.currentWeight);

  if (deltaPill) {
    const d = metrics.dayDelta;
    if (entries.length < 2) {
      deltaPill.className = 'pill neutral';
      deltaPill.textContent = '첫 기록';
    } else {
      deltaPill.className = `pill ${d < 0 ? 'down' : (d > 0 ? 'up' : 'neutral')}`;
      const icon = d < 0 ? '▼' : (d > 0 ? '▲' : '');
      deltaPill.textContent = `${icon} ${signed(d)}kg`.trim();
    }
  }
  if (lastDateEl) {
    const isToday = metrics.latestDate === getLocalDateString();
    lastDateEl.textContent = isToday ? '오늘 · 이전 기록 대비' : `${formatDateKo(metrics.latestDate)} 기록`;
  }

  if (maEl) maEl.textContent = fmt(metrics.avg7Days);
  if (remainEl) remainEl.textContent = fmt(metrics.remainingKg);
  if (progBar) progBar.style.width = `${metrics.progressPercent}%`;
  if (progText) progText.textContent = `목표 달성률 ${metrics.progressPercent}%`;

  if (metrics.bmiInfo) {
    if (bmiValEl) bmiValEl.textContent = metrics.bmiInfo.bmi;
    if (bmiBadgeEl) {
      bmiBadgeEl.textContent = metrics.bmiInfo.status.replace(' (과체중)', '');
      bmiBadgeEl.className = `pill ${metrics.bmiInfo.badgeClass}`;
    }
    if (bmiRangeEl) bmiRangeEl.textContent = `키 ${profile.height}cm 기준 정상 체중 범위(BMI 18.5~22.9): ${metrics.bmiInfo.healthyRange}`;
  }

  if (streakBadge) streakBadge.textContent = `🔥 ${metrics.streak}일`;
}

function renderInsights(entries, profile) {
  const metrics = Analytics.getOverviewMetrics(entries, profile);
  const projEl = document.getElementById('insightProjectionText');
  const rateEl = document.getElementById('insightRateText');
  const totalDeltaEl = document.getElementById('insightTotalDelta');

  if (!metrics || entries.length === 0) {
    if (projEl) projEl.textContent = '체중을 기록하면 목표 달성일을 예측해 드려요.';
    if (rateEl) rateEl.textContent = '매일 아침 공복에 재면 추세가 가장 정확해요.';
    if (totalDeltaEl) totalDeltaEl.textContent = '첫 기록부터 시작해 볼까요?';
    return;
  }

  if (projEl) projEl.innerHTML = metrics.projection.message;

  if (rateEl) {
    const rate = metrics.projection.weeklyRate;
    if (rate) {
      rateEl.innerHTML = `최근 2주 동안 주당 <strong>${signed(rate)}kg</strong> 페이스예요.`;
    } else {
      rateEl.textContent = '기록이 5일 이상 쌓이면 주간 페이스를 알려드려요.';
    }
  }

  if (totalDeltaEl) {
    totalDeltaEl.innerHTML = `첫 기록 대비 <strong>${signed(metrics.totalDelta)}kg</strong> · 총 ${entries.length}일 기록`;
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

  const entries = Storage.getEntries(); // 최신순
  const entryMap = {};
  const prevWeightMap = {};
  entries.forEach((e, i) => {
    entryMap[e.date] = e;
    const prev = entries[i + 1];
    if (prev) prevWeightMap[e.date] = prev.weight;
  });

  const startDayOfWeek = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  grid.innerHTML = '';

  ['일', '월', '화', '수', '목', '금', '토'].forEach(wd => {
    const h = document.createElement('div');
    h.className = 'calendar-weekday';
    h.textContent = wd;
    grid.appendChild(h);
  });

  for (let i = 0; i < startDayOfWeek; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell other-month';
    grid.appendChild(cell);
  }

  const todayStr = getLocalDateString();

  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar-cell';
    if (dateStr === todayStr) cell.classList.add('today');
    if (dateStr > todayStr) cell.classList.add('future');

    const dayNum = document.createElement('span');
    dayNum.className = 'cal-day-num';
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    const entry = entryMap[dateStr];
    if (entry) {
      cell.classList.add('has-data');
      const prevW = prevWeightMap[dateStr];
      if (prevW !== undefined) {
        const diff = +(entry.weight - prevW).toFixed(2);
        if (diff < 0) cell.classList.add('down');
        else if (diff > 0) cell.classList.add('up');
      }
      const wVal = document.createElement('span');
      wVal.className = 'cal-weight-val';
      wVal.textContent = fmt(entry.weight, 1);
      cell.appendChild(wVal);
      cell.setAttribute('aria-label', `${dateStr} ${fmt(entry.weight)}kg${entry.note ? ' · ' + entry.note : ''}`);
      cell.title = `${fmt(entry.weight)}kg${entry.note ? ' · ' + entry.note : ''}`;
    } else {
      cell.setAttribute('aria-label', `${dateStr} 기록 추가`);
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
  const countEl = document.getElementById('entriesCountText');
  if (countEl) countEl.textContent = entries.length ? `총 ${entries.length}개 · 최신순` : '최신순';

  tbody.innerHTML = '';

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="td-empty">아직 기록이 없어요. <strong>+</strong> 버튼으로 첫 체중을 기록해 보세요.</td></tr>`;
    return;
  }

  entries.forEach((e, idx) => {
    const tr = document.createElement('tr');

    const nextEntry = entries[idx + 1];
    let deltaHtml = '<span class="muted">—</span>';
    if (nextEntry) {
      const diff = +(e.weight - nextEntry.weight).toFixed(2);
      const cls = diff < 0 ? 'down' : (diff > 0 ? 'up' : 'neutral');
      deltaHtml = `<span class="pill ${cls}">${signed(diff)}</span>`;
    }

    tr.innerHTML = `
      <td class="td-date num">${escapeHtml(e.date.slice(5).replace('-', '.'))}<small>${e.date.slice(0, 4)} · ${e.timeOfDay === 'evening' ? '저녁' : '아침'}</small></td>
      <td class="td-weight num">${fmt(e.weight)}</td>
      <td>${deltaHtml}</td>
      <td class="num hide-sm">${e.bodyFat != null ? fmt(e.bodyFat) + '%' : '<span class="muted">—</span>'}</td>
      <td class="td-note hide-sm">${e.note ? escapeHtml(e.note) : '<span class="muted">—</span>'}</td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" data-action="edit" title="수정" aria-label="수정">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="btn-icon danger" data-action="delete" title="삭제" aria-label="삭제">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </td>
    `;

    tr.querySelector('[data-action="edit"]').addEventListener('click', () => {
      openRecordModal(e.date, e);
    });

    tr.querySelector('[data-action="delete"]').addEventListener('click', () => {
      confirmDelete(e);
    });

    tbody.appendChild(tr);
  });
}

function confirmDelete(entry) {
  if (!confirm(`${entry.date} 기록(${fmt(entry.weight)}kg)을 삭제할까요?`)) return false;
  Storage.saveSnapshot('기록 삭제');
  Storage.deleteEntry(entry.id || entry.date);
  refreshApp();
  showToast('삭제했어요. 설정 탭에서 되돌릴 수 있어요.');
  return true;
}

// ==========================================================================
// Modal Handlers (Record Form)
// ==========================================================================
function updateModalFieldsForEntry(targetDate, existingEntry, { keepValues = false } = {}) {
  const weightInput = document.getElementById('recordWeightInput');
  const timeOfDaySelect = document.getElementById('recordTimeOfDay');
  const bodyFatInput = document.getElementById('recordBodyFatInput');
  const muscleInput = document.getElementById('recordMuscleInput');
  const noteInput = document.getElementById('recordNoteInput');
  const deleteBtn = document.getElementById('btnModalDeleteRecord');
  const headerDeleteBtn = document.getElementById('btnModalHeaderDelete');
  const submitBtn = document.getElementById('btnModalSubmitRecord');
  const modalTitle = document.getElementById('modalTitle');
  const todayStr = getLocalDateString();
  const dateLabel = targetDate === todayStr ? '오늘' : formatDateKo(targetDate);

  editingEntryId = existingEntry ? existingEntry.id : null;

  if (existingEntry) {
    if (modalTitle) modalTitle.textContent = `${dateLabel} 기록 수정`;
    if (submitBtn) submitBtn.textContent = '수정 저장';
    weightInput.value = fmt(existingEntry.weight);
    timeOfDaySelect.value = existingEntry.timeOfDay === 'evening' ? 'evening' : 'morning';
    bodyFatInput.value = existingEntry.bodyFat != null ? fmt(existingEntry.bodyFat) : '';
    muscleInput.value = existingEntry.muscleMass != null ? fmt(existingEntry.muscleMass) : '';
    noteInput.value = existingEntry.note || '';

    const tags = Array.isArray(existingEntry.tags) ? existingEntry.tags : [];
    document.querySelectorAll('.tag-chip').forEach(c => {
      c.classList.toggle('selected', tags.includes(c.textContent.trim()));
    });

    const doDelete = () => {
      if (confirmDelete(existingEntry)) closeRecordModal();
    };
    if (deleteBtn) {
      deleteBtn.hidden = false;
      deleteBtn.onclick = doDelete;
    }
    if (headerDeleteBtn) {
      headerDeleteBtn.hidden = false;
      headerDeleteBtn.onclick = doDelete;
    }
  } else {
    if (modalTitle) modalTitle.textContent = `${dateLabel} 체중 기록`;
    if (submitBtn) submitBtn.textContent = '저장';

    if (!keepValues) {
      const latest = Storage.getEntries()[0];
      const defaultWeight = latest ? latest.weight : (Storage.getProfile().initialWeight || 72.0);
      weightInput.value = fmt(defaultWeight);
      timeOfDaySelect.value = 'morning';
      bodyFatInput.value = latest?.bodyFat != null ? fmt(latest.bodyFat) : '';
      muscleInput.value = latest?.muscleMass != null ? fmt(latest.muscleMass) : '';
      noteInput.value = '';
      document.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('selected'));
    }

    if (deleteBtn) {
      deleteBtn.hidden = true;
      deleteBtn.onclick = null;
    }
    if (headerDeleteBtn) {
      headerDeleteBtn.hidden = true;
      headerDeleteBtn.onclick = null;
    }
  }
}

function openRecordModal(defaultDate = null, existingEntry = null) {
  const modal = document.getElementById('recordModalBackdrop');
  if (!modal) return;

  const dateInput = document.getElementById('recordDateInput');
  const targetDate = defaultDate || existingEntry?.date || getLocalDateString();
  dateInput.value = targetDate;

  const entry = existingEntry || Storage.getEntries().find(e => e.date === targetDate);
  updateModalFieldsForEntry(targetDate, entry);

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeRecordModal() {
  document.getElementById('recordModalBackdrop')?.classList.remove('open');
  editingEntryId = null;
  if (!document.querySelector('.modal-backdrop.open')) document.body.style.overflow = '';
}

function handleRecordSubmit(e) {
  e.preventDefault();
  if (!document.getElementById('recordModalBackdrop')?.classList.contains('open')) return;
  const date = document.getElementById('recordDateInput').value;
  const weight = parseFloat(parseFloat(document.getElementById('recordWeightInput').value).toFixed(2));
  const timeOfDay = document.getElementById('recordTimeOfDay').value;
  const bodyFatVal = document.getElementById('recordBodyFatInput').value;
  const bodyFat = bodyFatVal !== '' && !isNaN(parseFloat(bodyFatVal)) ? parseFloat(parseFloat(bodyFatVal).toFixed(2)) : null;
  const muscleVal = document.getElementById('recordMuscleInput').value;
  const muscleMass = muscleVal !== '' && !isNaN(parseFloat(muscleVal)) ? parseFloat(parseFloat(muscleVal).toFixed(2)) : null;
  const note = document.getElementById('recordNoteInput').value.trim();

  const selectedTags = Array.from(document.querySelectorAll('.tag-chip.selected')).map(c => c.textContent.trim());

  if (!date || isNaN(weight) || weight < 20 || weight > 400) {
    alert('날짜와 올바른 체중(20~400kg)을 입력해주세요.');
    return;
  }

  const isEdit = !!editingEntryId;
  const entry = {
    date,
    weight,
    timeOfDay,
    bodyFat,
    muscleMass,
    note,
    tags: selectedTags
  };
  if (editingEntryId) entry.id = editingEntryId;

  Storage.saveEntry(entry);
  closeRecordModal();
  refreshApp();
  showToast(isEdit ? '기록을 수정했어요.' : `${fmt(weight)}kg 기록했어요.`);
}

// ==========================================================================
// Profile Form
// ==========================================================================
function loadProfileIntoForm() {
  const profile = Storage.getProfile();
  document.getElementById('profileHeight').value = profile.height || 175;
  document.getElementById('profileInitialWeight').value = fmt(profile.initialWeight || 75.0);
  document.getElementById('profileTargetWeight').value = fmt(profile.targetWeight || 68.0);
  document.getElementById('profileTargetDate').value = profile.targetDate || '';
  document.getElementById('profileGender').value = profile.gender || 'male';
}

function handleProfileSubmit(e) {
  e.preventDefault();
  const profile = {
    height: parseFloat(document.getElementById('profileHeight').value) || 175,
    initialWeight: parseFloat(parseFloat(document.getElementById('profileInitialWeight').value).toFixed(2)) || 75.0,
    targetWeight: parseFloat(parseFloat(document.getElementById('profileTargetWeight').value).toFixed(2)) || 68.0,
    targetDate: document.getElementById('profileTargetDate').value,
    gender: document.getElementById('profileGender').value
  };

  Storage.saveProfile(profile);
  refreshApp();
  showToast('목표를 저장했어요.');
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
      statusEl.textContent = `최근 동기화: ${new Date(config.lastSyncedAt).toLocaleString('ko-KR')}`;
    } else {
      statusEl.textContent = config.googleSheetUrl ? '연결 대기 중' : '로컬 모드 (구글 시트 미연결)';
    }
  }
}

function handleCloudConfigSubmit(e) {
  e.preventDefault();
  const url = document.getElementById('cloudGoogleSheetUrl').value.trim();
  if (url && !url.startsWith('https://script.google.com')) {
    alert('https://script.google.com 으로 시작하는 Apps Script 웹 앱 URL을 입력해주세요.');
    return;
  }
  const config = {
    googleSheetUrl: url,
    autoSync: document.getElementById('cloudAutoSync').checked,
    lastSyncedAt: Storage.getCloudConfig().lastSyncedAt
  };
  Storage.saveCloudConfig(config);
  updateCloudBadge();
  loadCloudConfigIntoForm();
  showToast('연동 설정을 저장했어요.');
}

async function handleManualSync() {
  const btn = document.getElementById('btnSyncNow');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '동기화 중…';
  }

  try {
    // 시트에만 있는 기록을 먼저 받아온 뒤 전체를 올린다 (어느 쪽 기록도 잃지 않도록)
    await Storage.pullFromGoogleSheets();
    const res = await Storage.syncWithGoogleSheets();
    refreshApp();
    loadCloudConfigIntoForm();
    showToast(`구글 시트 동기화 완료 (${res.count}개)`);
  } catch (err) {
    alert(`동기화 실패: ${err.message}\nApps Script 웹 앱 URL과 권한(모든 사용자) 설정을 확인해주세요.`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '지금 동기화';
    }
  }
}

function updateCloudBadge() {
  const badge = document.getElementById('cloudSyncBadge');
  if (!badge) return;
  const config = Storage.getCloudConfig();
  const text = badge.querySelector('.sync-text');
  if (config.googleSheetUrl) {
    badge.classList.add('online');
    if (text) text.textContent = '시트 연동';
    badge.title = '구글 시트 연동됨';
  } else {
    badge.classList.remove('online');
    if (text) text.textContent = '로컬 저장';
    badge.title = '이 기기에 저장 중';
  }
}

// ==========================================================================
// External Share & Dynamic QR Code
// ==========================================================================
function openShareModal() {
  const modal = document.getElementById('shareModalBackdrop');
  if (!modal) return;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  generateQR('shareModalQrContainer', 'modalShareUrlInput');
}

function closeShareModal() {
  document.getElementById('shareModalBackdrop')?.classList.remove('open');
  if (!document.querySelector('.modal-backdrop.open')) document.body.style.overflow = '';
}

function cleanShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('t');
  url.hash = '';
  return url.toString();
}

async function generateQR(containerId = 'qrcodeContainer', inputId = 'shareUrlInput') {
  const container = document.getElementById(containerId);
  const urlInput = document.getElementById(inputId);
  let targetUrl = cleanShareUrl();

  // 로컬 서버 실행 중일 때만 외부 터널 주소 사용
  if (Storage.isLocalServer()) {
    try {
      const res = await fetch('tunnel_info.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.url) targetUrl = data.url;
      }
    } catch (_) {}
  }

  if (urlInput) urlInput.value = targetUrl;
  if (!container) return;

  container.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(container, {
      text: targetUrl,
      width: 160,
      height: 160,
      colorDark: '#111418',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }
}

async function copyShareUrl(inputId = 'shareUrlInput') {
  const urlInput = document.getElementById(inputId);
  if (!urlInput) return;
  try {
    await navigator.clipboard.writeText(urlInput.value);
  } catch (_) {
    urlInput.select();
    document.execCommand('copy');
  }
  showToast('링크를 복사했어요.');
}

// ==========================================================================
// Backup & Export / Import / Undo
// ==========================================================================
function exportCSVFile() {
  downloadFile('﻿' + Storage.exportCSV(), `weight_records_${getLocalDateString()}.csv`, 'text/csv;charset=utf-8;');
}

function exportJSONFile() {
  downloadFile(Storage.exportJSON(), `weight_tracker_backup_${getLocalDateString()}.json`, 'application/json');
}

function handleJSONImport(e) {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      if (!confirm('백업 파일의 기록을 불러올까요?\n지금 기록은 유지되고, 같은 날짜는 백업 파일 값으로 바뀝니다.')) return;
      const count = Storage.importJSON(event.target.result);
      refreshApp();
      showToast(`백업에서 ${count}개 기록을 복원했어요.`);
    } catch (err) {
      alert(`복원 실패: ${err.message}`);
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

function renderSnapshotButton() {
  const btn = document.getElementById('btnRestoreSnapshot');
  const info = document.getElementById('snapshotInfoText');
  if (!btn) return;
  const snap = Storage.getSnapshotInfo();
  if (!snap) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  if (info) {
    const when = snap.savedAt ? new Date(snap.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    info.textContent = `${snap.reason || '이전 상태'} 직전 · 기록 ${snap.count}개 · ${when}`;
  }
}

function handleRestoreSnapshot() {
  const snap = Storage.getSnapshotInfo();
  if (!snap) return;
  if (!confirm(`'${snap.reason || '이전 상태'}' 직전의 기록 ${snap.count}개로 되돌릴까요?\n지금 상태도 따로 보관되어 다시 되돌릴 수 있어요.`)) return;
  try {
    const count = Storage.restoreSnapshot();
    refreshApp();
    showToast(`기록 ${count}개로 되돌렸어요.`);
  } catch (err) {
    alert(err.message);
  }
}
