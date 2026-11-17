// The bonus convention for toy games (see DEV_GUIDE.md, "Bonus, never refuse").
//
// Rule level 1 is a pure toy: every touch does the ordinary pleasant thing.
// Rule levels 2 and up add a BONUS target (a glowing bubble, the largest group, the named
// colour). A touch on the bonus target gives a bit more (a chord, extra sparks, a faster
// fill). A touch anywhere else STILL gives the ordinary pleasant result. A touch is never
// refused, never called wrong, and never makes a buzzer or a "try again".
//
// So games do not call onFailure for a non-bonus touch. Instead they keep a tally for the
// unit (one sheet, one jar, one picture) and report at the end whether the unit was
// "clean" for the rule dimension. Pure module.

export const BONUS_FROM_RULE_LEVEL = 2;
export const DEFAULT_CLEAN_SHARE = 0.5;

// Judge one accepted touch. `accepted` is always true: that is the whole point.
//   ruleLevel      the current rule level (1 = toy, no bonus exists)
//   onBonusTarget  did the touch land on the bonus target?
export function judgeTouch({ ruleLevel = 1, onBonusTarget = false } = {}) {
  const level = Number(ruleLevel);
  const offered = Number.isFinite(level) && level >= BONUS_FROM_RULE_LEVEL;
  return Object.freeze({
    accepted: true,
    bonusOffered: offered,
    bonus: offered && onBonusTarget === true,
  });
}

export function createBonusTally() {
  return { touches: 0, offered: 0, earned: 0 };
}

// Adds one judged touch to the tally and returns the new tally.
export function tallyTouch(tally, judged) {
  const current = tally && typeof tally === 'object' ? tally : createBonusTally();
  const result = judged && typeof judged === 'object' ? judged : {};
  return {
    touches: (Number(current.touches) || 0) + 1,
    offered: (Number(current.offered) || 0) + (result.bonusOffered === true ? 1 : 0),
    earned: (Number(current.earned) || 0) + (result.bonus === true ? 1 : 0),
  };
}

// The rule result for a finished unit, ready for the level ladder:
//   null  no bonus was on offer (rule level 1): leave the rule streak alone
//   true  he took the bonus on at least `cleanShare` of the touches where one was offered
//   false he mostly did not: the rule level may step down, quietly
export function ruleResultForUnit(tally, { cleanShare = DEFAULT_CLEAN_SHARE } = {}) {
  const offered = Number(tally?.offered) || 0;
  if (offered <= 0) return null;
  const earned = Math.max(0, Number(tally?.earned) || 0);
  const share = Number.isFinite(Number(cleanShare)) ? Number(cleanShare) : DEFAULT_CLEAN_SHARE;
  return earned / offered >= share;
}
