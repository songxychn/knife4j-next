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

/**
 * Serialize SSE events into a readable response body for send history.
 * Keeps full event payloads (subject to history truncation elsewhere).
 */
export function formatSseHistoryResponseBody(events: Array<{ data: string; timestamp?: number }>): string {
  if (events.length === 0) return '';
  return events
    .map((event, index) => {
      const time =
        typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
          ? ` ${formatSseEventTime(event.timestamp)}`
          : '';
      return `#${index + 1}${time}\n${event.data}`;
    })
    .join('\n\n');
}
