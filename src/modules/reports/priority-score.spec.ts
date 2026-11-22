import {
  RECOMMENDATION_PRIORITY_WEIGHT,
  calculatePriorityScore,
} from './priority-score';

describe('calculatePriorityScore', () => {
  it('gives each teacher recommendation the configured higher weight', () => {
    expect(RECOMMENDATION_PRIORITY_WEIGHT).toBe(3);
    expect(calculatePriorityScore(4, 2)).toBe(10);
  });

  it('does not allow a negative score', () => {
    expect(calculatePriorityScore(-2, -1)).toBe(0);
  });
});
