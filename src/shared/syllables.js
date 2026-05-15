/**
 * Syllable counter for English words.
 * Used to weight word durations for highlighting sync.
 * More syllables = longer spoken duration.
 *
 * Heuristic-based (no dictionary needed). ~85% accurate.
 */

/**
 * Count syllables in a single English word.
 * @param {string} word
 * @returns {number} syllable count (minimum 1)
 */
export function countSyllables(word) {
  if (!word || word.length === 0) return 1;

  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length === 0) return 1;
  if (word.length <= 3) return 1;

  // Remove silent e
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  // Remove leading y (acts as consonant)
  word = word.replace(/^y/, '');

  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? Math.max(matches.length, 1) : 1;
}

/**
 * Build timing weights for an array of words.
 * @param {string[]} words
 * @returns {{ words: string[], weights: number[], total: number }}
 */
export function buildWordWeights(words) {
  const weights = words.map(countSyllables);
  const total = weights.reduce((a, b) => a + b, 0);
  return { words, weights, total };
}

/**
 * Given a duration and word weights, compute the start time of each word.
 * @param {number} durationSeconds
 * @param {number[]} weights
 * @param {number} totalWeight
 * @returns {number[]} start time in seconds for each word
 */
export function computeWordStartTimes(durationSeconds, weights, totalWeight) {
  const times = [];
  let cumulative = 0;
  for (const w of weights) {
    times.push(cumulative);
    cumulative += durationSeconds * (w / totalWeight);
  }
  return times;
}
