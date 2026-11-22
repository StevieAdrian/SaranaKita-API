export const RECOMMENDATION_PRIORITY_WEIGHT = 3;

export function calculatePriorityScore(
  votes: number,
  recommendations: number,
): number {
  return (
    Math.max(0, votes) +
    Math.max(0, recommendations) * RECOMMENDATION_PRIORITY_WEIGHT
  );
}
