// The setup page's decisions, kept apart from the page so they can be tested:
// the page (setup.html) imports this from /assets/setup.js. Nothing here
// touches the DOM.

const STEPS = ['paper', 'connect', 'print']

/**
 * Which of the three steps is open: the one the reader chose (Edit, or a
 * step in the bar; nothing is locked), else the first not yet done. Once all
 * three are done, none: every step is one ticked line.
 */
export function openStep ({ done, chosen = null }) {
  if (STEPS.includes(chosen)) return chosen
  return STEPS.find((step) => !done[step]) || null
}

const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// The one line a finished "Your paper" folds down to.
export function paperLine ({ place, teams = [], topics = [] }) {
  const parts = [place, teams.length ? count(teams.length, 'team') : null, topics.length ? count(topics.length, 'topic') : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'The whole paper, no extras yet'
}
