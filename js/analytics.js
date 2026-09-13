/**
 * analytics.js - Statistical & Predictive Engine for Weight Tracking
 */

export const Analytics = {
  // Calculate BMI and Korean medical classification
  calculateBMI(weightKg, heightCm) {
    if (!weightKg || !heightCm || heightCm <= 0) return null;
    const heightM = heightCm / 100;
    const bmi = +(weightKg / (heightM * heightM)).toFixed(1);

    let status = '';
    let color = '';
    let badgeClass = '';

    if (bmi < 18.5) {
      status = '저체중';
      color = '#06b6d4';
      badgeClass = 'cyan';
    } else if (bmi < 23.0) {
      status = '정상 체중';
      color = '#10b981';
      badgeClass = 'down';
    } else if (bmi < 25.0) {
      status = '비만 전단계 (과체중)';
      color = '#f59e0b';
      badgeClass = 'neutral';
    } else if (bmi < 30.0) {
      status = '1단계 비만';
      color = '#f43f5e';
      badgeClass = 'up';
    } else {
      status = '2단계 고도비만';
      color = '#be123c';
      badgeClass = 'up';
    }

    // Healthy weight range (BMI 18.5 ~ 22.9)
    const healthyMin = +(18.5 * heightM * heightM).toFixed(1);
    const healthyMax = +(22.9 * heightM * heightM).toFixed(1);

    return {
      bmi,
      status,
      color,
      badgeClass,
      healthyRange: `${healthyMin} ~ ${healthyMax} kg`
    };
  },

  // Calculate N-day Moving Averages
  calculateMovingAverages(entries, windowSize = 7) {
    // Sort chronologically (oldest first)
    const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    const result = [];

    for (let i = 0; i < sorted.length; i++) {
      const window = sorted.slice(Math.max(0, i - windowSize + 1), i + 1);
      const sum = window.reduce((acc, curr) => acc + curr.weight, 0);
      const avg = +(sum / window.length).toFixed(2);
      result.push({
        date: sorted[i].date,
        weight: sorted[i].weight,
        sma: avg
      });
    }

    return result;
  },

  // Get Key Overview Metrics from entries & profile
  getOverviewMetrics(entries, profile) {
    if (!entries || entries.length === 0) {
      return null;
    }

    // Sorted chronological
    const sortedChrono = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = sortedChrono[sortedChrono.length - 1];
    const previous = sortedChrono.length > 1 ? sortedChrono[sortedChrono.length - 2] : null;
    const initial = sortedChrono[0];

    // Current Weight & 1-day Change
    const currentWeight = latest.weight;
    const dayDelta = previous ? +(currentWeight - previous.weight).toFixed(2) : 0;

    // Total change from initial entry
    const totalDelta = +(currentWeight - initial.weight).toFixed(2);

    // 7-day Moving Average for latest day
    const last7Days = sortedChrono.slice(-7);
    const avg7Days = +(last7Days.reduce((sum, e) => sum + e.weight, 0) / last7Days.length).toFixed(2);

    // Target Progress %
    const targetWeight = profile.targetWeight || 68.0;
    const startWeight = profile.initialWeight || initial.weight;
    const totalToLose = startWeight - targetWeight;
    const lostSoFar = startWeight - currentWeight;
    let progressPercent = 0;
    if (totalToLose > 0) {
      progressPercent = Math.min(100, Math.max(0, Math.round((lostSoFar / totalToLose) * 100)));
    } else if (totalToLose < 0) {
      // Bulking up goal
      progressPercent = Math.min(100, Math.max(0, Math.round(((currentWeight - startWeight) / (targetWeight - startWeight)) * 100)));
    }

    const remainingKg = +(Math.abs(currentWeight - targetWeight)).toFixed(2);

    // BMI
    const bmiInfo = this.calculateBMI(currentWeight, profile.height || 175);

    // Recent 14-day slope and projection
    const projection = this.calculateProjection(sortedChrono, targetWeight);

    // Streak calculation (consecutive days)
    const streak = this.calculateStreak(sortedChrono);

    return {
      latestDate: latest.date,
      currentWeight,
      dayDelta,
      totalDelta,
      avg7Days,
      targetWeight,
      remainingKg,
      progressPercent,
      bmiInfo,
      projection,
      streak,
      totalEntriesCount: entries.length
    };
  },

  // Calculate Estimated Goal Date based on recent velocity
  calculateProjection(sortedChrono, targetWeight) {
    if (sortedChrono.length < 5) {
      return {
        weeklyRate: 0,
        estimatedDate: null,
        daysRemaining: null,
        message: '더 많은 기록(최소 5일 이상)이 쌓이면 목표 달성일을 정확히 예측해 드립니다.'
      };
    }

    // Look at last 14 days (or all if < 14)
    const recent = sortedChrono.slice(-14);
    const firstRecent = recent[0];
    const lastRecent = recent[recent.length - 1];

    const dayDiff = Math.max(1, Math.round((new Date(lastRecent.date) - new Date(firstRecent.date)) / (1000 * 60 * 60 * 24)));
    const weightDiff = lastRecent.weight - firstRecent.weight; // negative if losing weight

    // Daily rate of change
    const dailyRate = weightDiff / dayDiff;
    const weeklyRate = +(dailyRate * 7).toFixed(2);

    const neededDiff = targetWeight - lastRecent.weight;

    // Check if moving toward goal
    if ((neededDiff < 0 && dailyRate < -0.01) || (neededDiff > 0 && dailyRate > 0.01)) {
      const daysNeeded = Math.round(Math.abs(neededDiff / dailyRate));
      const targetDateObj = new Date();
      targetDateObj.setDate(targetDateObj.getDate() + daysNeeded);

      const estimatedDateStr = `${targetDateObj.getFullYear()}년 ${targetDateObj.getMonth() + 1}월 ${targetDateObj.getDate()}일`;

      return {
        weeklyRate,
        estimatedDate: estimatedDateStr,
        daysRemaining: daysNeeded,
        message: `최근 2주 추세(주당 ${Math.abs(weeklyRate)}kg 감량) 지속 시, 약 <strong>${daysNeeded}일 뒤(${estimatedDateStr})</strong> 목표 달성 예상! 🎉`
      };
    } else if (Math.abs(neededDiff) <= 0.2) {
      return {
        weeklyRate,
        estimatedDate: '달성 완료',
        daysRemaining: 0,
        message: '축하합니다! 이미 목표 체중에 도달하셨습니다! 🏆 현재 체중 유지를 목표로 이어가세요.'
      };
    } else {
      return {
        weeklyRate,
        estimatedDate: null,
        daysRemaining: null,
        message: '현재 체중 정체 또는 유지 구간입니다. 일관된 기록과 식단 루틴을 지속해 보세요! 💪'
      };
    }
  },

  // Calculate consecutive logging streak
  calculateStreak(sortedChrono) {
    if (sortedChrono.length === 0) return 0;

    const loggedDates = new Set(sortedChrono.map(e => e.date));
    let streak = 0;
    const checkDate = new Date();

    // Check today or yesterday
    const todayStr = checkDate.toISOString().split('T')[0];
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterdayStr = checkDate.toISOString().split('T')[0];

    let currentCheck = loggedDates.has(todayStr) ? new Date() : (loggedDates.has(yesterdayStr) ? checkDate : null);

    if (!currentCheck) return 0;

    while (true) {
      const dateStr = currentCheck.toISOString().split('T')[0];
      if (loggedDates.has(dateStr)) {
        streak++;
        currentCheck.setDate(currentCheck.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  },

  // Group by weeks for weekly delta bar chart
  getWeeklyAggregates(entries) {
    const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (sorted.length === 0) return [];

    const weeks = {};

    sorted.forEach(e => {
      const d = new Date(e.date);
      // Get Monday of this week
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      const weekKey = d.toISOString().split('T')[0];

      if (!weeks[weekKey]) {
        weeks[weekKey] = [];
      }
      weeks[weekKey].push(e);
    });

    const result = [];
    const keys = Object.keys(weeks).sort();

    keys.forEach((key, idx) => {
      const list = weeks[key];
      const startW = list[0].weight;
      const endW = list[list.length - 1].weight;
      const prevWeekEnd = idx > 0 ? weeks[keys[idx - 1]][weeks[keys[idx - 1]].length - 1].weight : startW;
      const delta = +(endW - prevWeekEnd).toFixed(2);

      const d = new Date(key);
      const label = `${d.getMonth() + 1}월 ${Math.ceil(d.getDate() / 7)}주차`;

      result.push({
        weekKey: key,
        label,
        avgWeight: +(list.reduce((acc, c) => acc + c.weight, 0) / list.length).toFixed(2),
        delta: delta,
        count: list.length
      });
    });

    return result.slice(-8); // return last 8 weeks
  }
};
