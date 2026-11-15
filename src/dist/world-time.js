export const WORLD_SECONDS_PER_DAY = 60;
export const WORLD_SECONDS_PER_HOUR = WORLD_SECONDS_PER_DAY / 24;

const worldStart = Date.UTC(2077, 3, 1);
const worldHourMilliseconds = 60 * 60 * 1000;
const worldMaxHours = Math.floor((8640000000000000 - worldStart) / worldHourMilliseconds);

function worldElapsedHours(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  const worldHours = seconds / WORLD_SECONDS_PER_HOUR;
  return worldHours <= worldMaxHours ? worldHours : 0;
}

function worldHourDuration(hours) {
  const worldDays = Math.floor(hours / 24);
  const worldHours = hours % 24;
  return `${worldDays ? `${worldDays}天` : ''}${worldHours ? `${worldHours}小时` : ''}`;
}

// 游戏时间保持秒数；所有日期统一由这里换算，避免本机时区改变故事时间。
export function worldTime(seconds) {
  const worldHours = Math.floor(worldElapsedHours(seconds));
  const worldDate = new Date(worldStart + worldHours * worldHourMilliseconds);
  const worldYear = worldDate.getUTCFullYear();
  const worldMonth = String(worldDate.getUTCMonth() + 1).padStart(2, '0');
  const worldDay = String(worldDate.getUTCDate()).padStart(2, '0');
  const worldHour = String(worldDate.getUTCHours()).padStart(2, '0');
  const worldDateText = `${worldYear}.${worldMonth}.${worldDay}`;
  return {
    date: worldDateText,
    shortDate: `${worldMonth}.${worldDay}`,
    hour: worldHour,
    day: Math.floor(worldHours / 24) + 1,
    label: `${worldYear}年${Number(worldMonth)}月${Number(worldDay)}日 ${worldHour}时`,
    stamp: `${worldDateText} · ${worldHour}时`,
    iso: worldDate.toISOString(),
  };
}

export function worldDuration(seconds) {
  const worldHours = Math.floor(worldElapsedHours(seconds));
  return worldHours ? worldHourDuration(worldHours) : '不足1小时';
}

export function worldRemaining(seconds) {
  const worldHours = worldElapsedHours(seconds);
  if (!worldHours) return '已完成';
  if (worldHours < 1) return '不到1小时';
  return `约${worldHourDuration(Math.ceil(worldHours))}`;
}
