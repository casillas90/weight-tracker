/**
 * charts.js - Chart.js Visualizations for Weight Tracker & Analytics
 */

import { Analytics } from './analytics.js?v=20261012_4';
import { parseLocalDate } from './storage.js?v=20261012_4';


const FONT_FAMILY = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function palette() {
  return {
    weight: cssVar('--chart-weight', '#14b8a6'),
    weightFill: cssVar('--chart-weight-fill', 'rgba(20, 184, 166, 0.18)'),
    trend: cssVar('--chart-trend', '#6366f1'),
    target: cssVar('--chart-target', '#f59e0b'),
    good: cssVar('--good', '#10b981'),
    bad: cssVar('--bad', '#f43f5e'),
    fat: cssVar('--chart-fat', '#f59e0b'),
    muscle: cssVar('--chart-muscle', '#6366f1'),
    grid: cssVar('--chart-grid', 'rgba(127, 127, 127, 0.12)'),
    text: cssVar('--text-muted', '#8a8f98'),
    surface: cssVar('--surface', '#ffffff'),
    tooltipBg: cssVar('--tooltip-bg', 'rgba(17, 24, 39, 0.95)'),
    tooltipText: cssVar('--tooltip-text', '#f9fafb')
  };
}

// 데이터가 없을 때 캔버스 대신 안내 문구를 보여준다
function setEmpty(canvas, message) {
  const wrap = canvas.parentElement;
  if (!wrap) return;
  if (message) {
    wrap.dataset.empty = message;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    delete wrap.dataset.empty;
  }
}

function tooltipBase(c) {
  return {
    backgroundColor: c.tooltipBg,
    titleColor: c.tooltipText,
    bodyColor: c.tooltipText,
    borderWidth: 0,
    padding: 10,
    cornerRadius: 10,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { family: FONT_FAMILY, weight: '600', size: 12 },
    bodyFont: { family: FONT_FAMILY, size: 12 }
  };
}

let trendChartInstance = null;
let weeklyDeltaChartInstance = null;
let compositionChartInstance = null;

export const Charts = {
  // Initialize or update main trend chart
  renderTrendChart(canvasId, entries, profile, timeFilter = '30D') {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const c = palette();

    const filteredEntries = this.filterEntriesByTime(entries, timeFilter);
    if (trendChartInstance) {
      trendChartInstance.destroy();
      trendChartInstance = null;
    }
    if (filteredEntries.length === 0) {
      setEmpty(canvas, entries.length === 0
        ? '아직 기록이 없어요. 첫 체중을 기록해 보세요.'
        : '이 기간에는 기록이 없어요. 기간을 넓혀 보세요.');
      return;
    }
    setEmpty(canvas, null);

    const ctx = canvas.getContext('2d');
    const sorted = [...filteredEntries].sort((a, b) => a.date.localeCompare(b.date));

    // 이동평균은 기간 밖의 이전 기록까지 반영해 계산한 뒤 잘라낸다
    const allMa = Analytics.calculateMovingAverages(entries, 7);
    const maByDate = new Map(allMa.map(d => [d.date, d.sma]));

    const labels = sorted.map(e => {
      const parts = e.date.split('-');
      return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
    });

    const target = Number(profile.targetWeight) || 68.0;
    const weightValues = sorted.map(e => e.weight);
    const maValues = sorted.map(e => maByDate.get(e.date) ?? null);
    const targetValues = sorted.map(() => target);

    const allWeights = [...weightValues, target];
    const minW = Math.floor(Math.min(...allWeights) - 1);
    const maxW = Math.ceil(Math.max(...allWeights) + 1);

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 300);
    gradient.addColorStop(0, c.weightFill);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    trendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '체중',
            data: weightValues,
            borderColor: c.weight,
            backgroundColor: gradient,
            borderWidth: 2.25,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: c.weight,
            pointBorderColor: c.surface,
            pointBorderWidth: 2,
            pointRadius: labels.length > 40 ? 0 : 3.5,
            pointHoverRadius: 6,
            order: 2
          },
          {
            label: '7일 평균',
            data: maValues,
            borderColor: c.trend,
            borderWidth: 2,
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            order: 1
          },
          {
            label: '목표',
            data: targetValues,
            borderColor: c.target,
            borderWidth: 1.5,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 0,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase(c),
            callbacks: {
              title: (items) => {
                const entry = sorted[items[0].dataIndex];
                return `${entry.date} · ${entry.timeOfDay === 'evening' ? '저녁' : '아침 공복'}`;
              },
              label: (item) => {
                if (item.raw == null) return null;
                return ` ${item.dataset.label}  ${Number(item.raw).toFixed(2)}kg`;
              },
              afterBody: (items) => {
                const entry = sorted[items[0].dataIndex];
                const notes = [];
                if (entry.bodyFat != null) notes.push(`체지방 ${entry.bodyFat}%`);
                if (entry.note) notes.push(entry.note);
                return notes;
              }
            }
          }
        },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: {
              color: c.text,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 7,
              font: { family: FONT_FAMILY, size: 11 }
            }
          },
          y: {
            min: minW,
            max: maxW,
            border: { display: false },
            grid: { color: c.grid },
            ticks: {
              color: c.text,
              maxTicksLimit: 6,
              callback: (val) => `${val}`,
              font: { family: FONT_FAMILY, size: 11 }
            }
          }
        }
      }
    });
  },

  // Weekly Delta Bar Chart
  renderWeeklyDeltaChart(canvasId, entries) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const c = palette();
    const weeklyData = Analytics.getWeeklyAggregates(entries);

    if (weeklyDeltaChartInstance) {
      weeklyDeltaChartInstance.destroy();
      weeklyDeltaChartInstance = null;
    }
    if (weeklyData.length < 2) {
      setEmpty(canvas, '2주 이상 기록하면 주간 변화가 표시돼요.');
      return;
    }
    setEmpty(canvas, null);

    // 첫 주는 비교 대상이 없으므로 제외
    const data = weeklyData.slice(1);
    const deltas = data.map(w => w.delta);

    weeklyDeltaChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.map(w => w.label),
        datasets: [{
          label: '주간 증감',
          data: deltas,
          backgroundColor: deltas.map(d => d <= 0 ? c.good : c.bad),
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 28
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase(c),
            callbacks: {
              label: (context) => {
                const val = context.parsed.y;
                return ` ${val > 0 ? '+' : ''}${Number(val).toFixed(2)} kg`;
              }
            }
          }
        },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: c.text, font: { family: FONT_FAMILY, size: 11 } }
          },
          y: {
            border: { display: false },
            grid: { color: c.grid },
            ticks: {
              color: c.text,
              maxTicksLimit: 5,
              callback: (val) => `${val > 0 ? '+' : ''}${val}`,
              font: { family: FONT_FAMILY, size: 11 }
            }
          }
        }
      }
    });
  },

  // Body Composition Dual-Axis Chart (Body Fat % vs Muscle kg)
  renderCompositionChart(canvasId, entries) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const c = palette();

    const validEntries = entries
      .filter(e => e.bodyFat != null || e.muscleMass != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (compositionChartInstance) {
      compositionChartInstance.destroy();
      compositionChartInstance = null;
    }
    if (validEntries.length < 2) {
      setEmpty(canvas, '체지방률·골격근량을 2번 이상 기록하면 표시돼요.');
      return;
    }
    setEmpty(canvas, null);

    const labels = validEntries.map(e => {
      const parts = e.date.split('-');
      return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
    });

    compositionChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '체지방률 (%)',
            data: validEntries.map(e => e.bodyFat),
            borderColor: c.fat,
            backgroundColor: c.fat,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            spanGaps: true,
            yAxisID: 'yFat'
          },
          {
            label: '골격근량 (kg)',
            data: validEntries.map(e => e.muscleMass),
            borderColor: c.muscle,
            backgroundColor: c.muscle,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            spanGaps: true,
            yAxisID: 'yMuscle'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: c.text,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              font: { family: FONT_FAMILY, size: 12 }
            }
          },
          tooltip: tooltipBase(c)
        },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: { color: c.text, maxTicksLimit: 6, maxRotation: 0, font: { family: FONT_FAMILY, size: 11 } }
          },
          yFat: {
            type: 'linear',
            position: 'left',
            border: { display: false },
            grid: { color: c.grid },
            ticks: { color: c.text, maxTicksLimit: 5, callback: (v) => `${v}%`, font: { family: FONT_FAMILY, size: 11 } }
          },
          yMuscle: {
            type: 'linear',
            position: 'right',
            border: { display: false },
            grid: { display: false },
            ticks: { color: c.text, maxTicksLimit: 5, callback: (v) => `${v}kg`, font: { family: FONT_FAMILY, size: 11 } }
          }
        }
      }
    });
  },

  // Helper: Filter by time button
  filterEntriesByTime(entries, filter) {
    if (filter === 'ALL') return entries;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let days = 30;
    if (filter === '7D') days = 7;
    else if (filter === '30D') days = 30;
    else if (filter === '90D') days = 90;
    else if (filter === '180D') days = 180;
    else if (filter === '1Y') days = 365;

    now.setDate(now.getDate() - (days - 1));
    return entries.filter(e => parseLocalDate(e.date) >= now);
  }
};
