const PHASE_LABEL = {
  morning: "早晨",
  day: "白天",
  night: "夜晚",
};

const CN_DAY = [
  "",
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
];

function fallbackDayLabel(day) {
  if (day >= 1 && day < CN_DAY.length) {
    return CN_DAY[day];
  }
  return `第${day}日`;
}

function monthLabelByIndex(index) {
  const names = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const normalized = ((index % 12) + 12) % 12;
  return names[normalized];
}

function parseChineseMonthIndex(monthLabel) {
  const map = {
    正月: 0, 一月: 0, 二月: 1, 三月: 2, 四月: 3, 五月: 4, 六月: 5,
    七月: 6, 八月: 7, 九月: 8, 十月: 9, 十一月: 10, 十二月: 11,
  };
  return map[monthLabel] ?? 0;
}

export function phaseLabel(phase) {
  return PHASE_LABEL[phase] ?? phase;
}

export function dayTimelineLabel(world, day) {
  const timeline = world.metadata?.timeline ?? {};
  const daysPerMonth = Math.max(28, Math.min(31, Number(timeline.daysPerMonth ?? 30)));
  const monthNames = Array.isArray(timeline.monthNames) ? timeline.monthNames : [];
  const startMonthIndex = Number.isFinite(Number(timeline.startMonthIndex))
    ? Number(timeline.startMonthIndex)
    : parseChineseMonthIndex(timeline.monthLabel ?? "十月");
  const monthOffset = Math.floor((day - 1) / daysPerMonth);
  const dayInMonth = ((day - 1) % daysPerMonth) + 1;
  const monthIndex = startMonthIndex + monthOffset;
  const monthLabel = monthNames[monthOffset]
    ?? monthLabelByIndex(monthIndex);
  const dayLabel = fallbackDayLabel(dayInMonth);
  const parts = [timeline.era, monthLabel, dayLabel].filter(Boolean);
  return parts.join(" ");
}

export function timelineLabel(world, day, phase) {
  return `${dayTimelineLabel(world, day)}·${phaseLabel(phase)}`;
}
