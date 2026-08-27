export interface AvailabilitySuggestionV1 {
  start: string;
  end: string;
}

export interface CommonFreeSlotInputV1 {
  startAt: Date;
  endAt: Date;
  intervalMinutes: number;
  durationMinutes: number;
  availabilityViews: string[];
  maxSuggestions?: number;
}

export class MeetingAvailabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingAvailabilityValidationError';
  }
}

function assertValidInput(input: CommonFreeSlotInputV1): void {
  const start = input.startAt.getTime();
  const end = input.endAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new MeetingAvailabilityValidationError('Availability range must have a valid end after start.');
  }
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 1440) {
    throw new MeetingAvailabilityValidationError('intervalMinutes must be between 5 and 1440.');
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < input.intervalMinutes || input.durationMinutes > 480) {
    throw new MeetingAvailabilityValidationError('durationMinutes must be between intervalMinutes and 480.');
  }
  if (input.durationMinutes % input.intervalMinutes !== 0) {
    throw new MeetingAvailabilityValidationError('durationMinutes must be divisible by intervalMinutes.');
  }
}

export function findCommonFreeSlotsV1(input: CommonFreeSlotInputV1): AvailabilitySuggestionV1[] {
  assertValidInput(input);
  if (!input.availabilityViews.length) return [];

  const slotMs = input.intervalMinutes * 60_000;
  const requiredSlots = input.durationMinutes / input.intervalMinutes;
  const totalSlots = Math.floor((input.endAt.getTime() - input.startAt.getTime()) / slotMs);
  const maxSuggestions = Math.min(20, Math.max(1, input.maxSuggestions ?? 8));

  const normalizedViews = input.availabilityViews.map((view) => view.padEnd(totalSlots, '4').slice(0, totalSlots));
  const free = Array.from({ length: totalSlots }, (_, index) => normalizedViews.every((view) => view[index] === '0'));
  const suggestions: AvailabilitySuggestionV1[] = [];

  for (let index = 0; index <= totalSlots - requiredSlots; index += 1) {
    let allFree = true;
    for (let offset = 0; offset < requiredSlots; offset += 1) {
      if (!free[index + offset]) {
        allFree = false;
        index += offset;
        break;
      }
    }
    if (!allFree) continue;

    const start = new Date(input.startAt.getTime() + index * slotMs);
    const end = new Date(start.getTime() + input.durationMinutes * 60_000);
    suggestions.push({ start: start.toISOString(), end: end.toISOString() });
    if (suggestions.length >= maxSuggestions) break;

    // Avoid returning overlapping suggestions that differ only by one interval.
    index += Math.max(0, requiredSlots - 1);
  }

  return suggestions;
}
