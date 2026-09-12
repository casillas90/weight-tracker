/**
 * charts.js - Chart.js Visualizations for Weight Tracker & Analytics
 */

import { Analytics } from './analytics.js';

let trendChartInstance = null;
let weeklyDeltaChartInstance = null;
let compositionChartInstance = null;

export const Charts = {
  // Initialize or update main trend chart
  renderTrendChart(canvasId, entries, profile, timeFilter = '30D') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    // 1. Filter entries by time range
    const filteredEntries = this.filterEntriesByTime(entries, timeFilter);
    if (filteredEntries.length === 0) {
      if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.font = '600 14px Plus Jakarta Sans, sans-serif';
      ctx.fillStyle = isDark ? '#6b7280' : '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('아직 기록된 체중 데이터가 없습니다.', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '500 12px Plus Jakarta Sans, sans-serif';
      ctx.fillText('상단의 [+ 오늘 체중 기록하기]를 눌러 첫 기록을 남겨보세요!', canvas.width / 2, canvas.height / 2 + 14);
      ctx.restore();
      return;
    }

    // Chronological order
    const sorted = [...filteredEntries].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate 7-day moving average
    const maData = Analytics.calculateMovingAverages(sorted, 7);

    const labels = sorted.map(e => {
      const parts = e.date.split('-');
      return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
    });

    const weightValues = sorted.map(e => e.weight);
    const maValues = maData.map(d => d.sma);
    const targetValues = sorted.map(() => profile.targetWeight || 68.0);

    // Calculate Y-axis bounds
    const allWeights = [...weightValues, profile.targetWeight || 68.0];
    const minW = Math.floor(Math.min(...allWeights) - 1.5);
    const maxW = Math.ceil(Math.max(...allWeights) + 1.5);

    // Gradient fill for weight line
    const gradient = ctx.createLinearGradient(0, 0, 0, 320);
    if (isDark) {
      gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
      gradient.addColorStop(1, 'rgba(16, 185, 129, 0.00)');
    } else {
      gradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
      gradient.addColorStop(1, 'rgba(16, 185, 129, 0.02)');
    }

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    if (trendChartInstance) {
      trendChartInstance.destroy();
    }

    trendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '일일 체중 (kg)',
            data: weightValues,
            borderColor: '#10b981',
            backgroundColor: gradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#10b981',
            pointBorderColor: isDark ? '#111827' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: labels.length > 40 ? 0 : 4,
            pointHoverRadius: 6,
            order: 2
          },
          {
            label: '7일 이동평균 (추세)',
            data: maValues,
            borderColor: '#06b6d4',
            borderWidth: 2,
            borderDash: [4, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 5,
            order: 1
          },
          {
            label: '목표 체중',
            data: targetValues,
            borderColor: '#8b5cf6',
            borderWidth: 1.5,
            borderDash: [6, 6],
            fill: false,
            pointRadius: 0,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false // Custom HTML legend used
          },
          tooltip: {
            backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#f9fafb' : '#0f172a',
            bodyColor: isDark ? '#d1d5db' : '#334155',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)',
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                const entry = sorted[idx];
                return `${entry.date} (${entry.timeOfDay === 'evening' ? '저녁' : '아침 공복'})`;
              },
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const entry = sorted[idx];
                const notes = [];
                if (entry.note) notes.push(`💬 ${entry.note}`);
                if (entry.bodyFat) notes.push(`체지방: ${entry.bodyFat}%`);
                return notes.length ? ['----------------', ...notes] : [];
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
              drawBorder: false
            },
            ticks: {
              color: textColor,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
              font: {
                family: 'Plus Jakarta Sans',
                size: 11
              }
            }
          },
          y: {
            min: minW,
            max: maxW,
            grid: {
              color: gridColor,
              drawBorder: false
            },
            ticks: {
              color: textColor,
              callback: (val) => `${val}kg`,
              font: {
                family: 'JetBrains Mono',
                size: 11
              }
            }
          }
        }
      }
    });
  },

  // Weekly Delta Bar Chart
  renderWeeklyDeltaChart(canvasId, entries) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const weeklyData = Analytics.getWeeklyAggregates(entries);

    if (weeklyData.length === 0) {
      if (weeklyDeltaChartInstance) {
        weeklyDeltaChartInstance.destroy();
        weeklyDeltaChartInstance = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.font = '500 13px Plus Jakarta Sans, sans-serif';
      ctx.fillStyle = isDark ? '#6b7280' : '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('주간 기록이 쌓이면 증감량이 표시됩니다.', canvas.width / 2, canvas.height / 2);
      ctx.restore();
      return;
    }

    const labels = weeklyData.map(w => w.label);
    const deltas = weeklyData.map(w => w.delta);
    const bgColors = deltas.map(d => d <= 0 ? '#10b981' : '#f43f5e');

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    if (weeklyDeltaChartInstance) {
      weeklyDeltaChartInstance.destroy();
    }

    weeklyDeltaChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '주간 증감량 (kg)',
          data: deltas,
          backgroundColor: bgColors,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#f9fafb' : '#0f172a',
            bodyColor: isDark ? '#d1d5db' : '#334155',
            callbacks: {
              label: (context) => {
                const val = context.parsed.y;
                return ` ${val > 0 ? '+' : ''}${val} kg`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'Plus Jakarta Sans', size: 11 }
            }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              callback: (val) => `${val > 0 ? '+' : ''}${val}kg`,
              font: { family: 'JetBrains Mono', size: 11 }
            }
          }
        }
      }
    });
  },

  // Body Composition Dual-Axis Chart (Weight vs Body Fat %)
  renderCompositionChart(canvasId, entries) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

    // Filter only entries that have bodyFat or muscleMass
    const validEntries = entries.filter(e => e.bodyFat || e.muscleMass).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (validEntries.length < 2) {
      if (compositionChartInstance) {
        compositionChartInstance.destroy();
        compositionChartInstance = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.font = '500 13px Plus Jakarta Sans, sans-serif';
      ctx.fillStyle = isDark ? '#6b7280' : '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText('체지방률이나 골격근량을 기록하시면 차트가 표시됩니다.', canvas.width / 2, canvas.height / 2);
      ctx.restore();
      return;
    }

    const labels = validEntries.map(e => {
      const parts = e.date.split('-');
      return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
    });

    const bodyFats = validEntries.map(e => e.bodyFat || null);
    const muscles = validEntries.map(e => e.muscleMass || null);

    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    if (compositionChartInstance) {
      compositionChartInstance.destroy();
    }

    compositionChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: '체지방률 (%)',
            data: bodyFats,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 4,
            yAxisID: 'yFat'
          },
          {
            label: '골격근량 (kg)',
            data: muscles,
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 4,
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
            labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 12 } }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          },
          yFat: {
            type: 'linear',
            position: 'left',
            grid: { color: gridColor },
            ticks: {
              color: '#f59e0b',
              callback: (v) => `${v}%`,
              font: { family: 'JetBrains Mono', size: 11 }
            }
          },
          yMuscle: {
            type: 'linear',
            position: 'right',
            grid: { display: false },
            ticks: {
              color: '#8b5cf6',
              callback: (v) => `${v}kg`,
              font: { family: 'JetBrains Mono', size: 11 }
            }
          }
        }
      }
    });
  },

  // Helper: Filter by time button
  filterEntriesByTime(entries, filter) {
    if (filter === 'ALL') return entries;

    const now = new Date();
    let days = 30;
    if (filter === '7D') days = 7;
    else if (filter === '30D') days = 30;
    else if (filter === '90D') days = 90;
    else if (filter === '180D') days = 180;
    else if (filter === '1Y') days = 365;

    const cutoff = new Date(now.setDate(now.getDate() - days));
    return entries.filter(e => new Date(e.date) >= cutoff);
  }
};
