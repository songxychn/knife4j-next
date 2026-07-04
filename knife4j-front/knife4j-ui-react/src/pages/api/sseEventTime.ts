function padNumber(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function formatSseEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${padNumber(date.getHours(), 2)}:${padNumber(date.getMinutes(), 2)}:${padNumber(
    date.getSeconds(),
    2,
  )}.${padNumber(date.getMilliseconds(), 3)}`;
}
