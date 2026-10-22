/** None | Easy | Hard switch for a day's climbing (Workout and History). "None" = no climbing that day. */
import { CLIMB } from '../core/climbs.js';
import { esc } from './dom.js';

export const NO_CLIMB = 'none';
const OPTIONS = [[NO_CLIMB, 'None'], [CLIMB.EASY, 'Easy'], [CLIMB.HARD, 'Hard']];

/** @param current 'easy' | 'hard' | null  @param action data-action for the buttons */
export function climbSwitch(date, current, action, label) {
  const selected = current ?? NO_CLIMB;
  return `<div class="seg climb-seg" role="group" aria-label="${esc(label)}">${OPTIONS.map(([value, text]) =>
    `<button type="button" data-action="${action}" data-date="${date}" data-intensity="${value}" aria-pressed="${selected === value}">${text}</button>`).join('')}</div>`;
}

/** The intensity to save for a tap: null clears the day. */
export const climbChoice = intensity => (intensity === CLIMB.EASY || intensity === CLIMB.HARD ? intensity : null);
