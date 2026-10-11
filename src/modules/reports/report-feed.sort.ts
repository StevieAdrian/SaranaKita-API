import type { ReportSort } from './dto/list-reports.dto';
import type { FeedReport } from './report-feed.mapper';

export const DB_SORTS: readonly ReportSort[] = ['latest', 'oldest'];

function newestFirst(a: FeedReport, b: FeedReport): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export function compareFeedReports(
  sort: ReportSort,
): (a: FeedReport, b: FeedReport) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => a.createdAt.localeCompare(b.createdAt);
    case 'most_votes':
      return (a, b) => b.votes - a.votes || newestFirst(a, b);
    case 'least_votes':
      return (a, b) => a.votes - b.votes || newestFirst(a, b);
    case 'most_recommendations':
      return (a, b) =>
        b.recommendations - a.recommendations ||
        b.votes - a.votes ||
        newestFirst(a, b);
    case 'latest':
    default:
      return newestFirst;
  }
}
