import { toUserRole, type UserRole } from '../../common/utils/resolve-role';
import { toReportStatus, type ReportStatus } from './report-feed.mapper';

type Related<T> = T | T[] | null | undefined;

export type ReportDetailRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  broken_date: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string | null;
  verified_by: string | null;
  rejected_by: string | null;
  updated_by: string | null;
  status: Related<{ status_name: string | null }>;
  category: Related<{ id: string; category_name: string | null }>;
  reporter: Related<{
    username: string | null;
    roles: Related<{ role_name: string | null }>;
    profile: Related<{
      full_name: string | null;
      class: string | null;
      profile_pict: string | null;
    }>;
  }>;
  reports_votes: Related<{ count: number }>;
  reports_comments: Related<{ count: number }>;
  recommendations: Related<{ count: number }>;
};

export type ReportTimelineEvent = {
  type: 'created' | ReportStatus;
  at: string;
};

export type ReportDetail = {
  id: string;
  title: string;
  description: string;
  location: string;
  brokenDate: string | null;
  category: { id: string; name: string } | null;
  status: ReportStatus;
  imageUrls: string[];
  reporter: {
    name: string;
    role: UserRole | null;
    className: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  votes: number;
  comments: number;
  recommendations: number;
  votedByMe: boolean;
  verifiedBy: string | null;
  rejectedBy: string | null;
  updatedBy: string | null;
  timeline: ReportTimelineEvent[];
};

export const REPORT_DETAIL_SELECT = [
  'id',
  'title',
  'description',
  'location',
  'broken_date',
  'image_url',
  'created_at',
  'updated_at',
  'verified_by',
  'rejected_by',
  'updated_by',
  'status(status_name)',
  'category(id, category_name)',
  'reporter:user!report_reporter_id_fkey(username, roles(role_name), profile(full_name, class, profile_pict))',
  'reports_votes(count)',
  'reports_comments(count)',
  'recommendations(count)',
].join(', ');

function first<T>(value: Related<T>): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function buildTimeline(
  status: ReportStatus,
  createdAt: string,
  updatedAt: string | null,
): ReportTimelineEvent[] {
  const events: ReportTimelineEvent[] = [{ type: 'created', at: createdAt }];
  if (status !== 'waiting_verification') {
    events.push({ type: status, at: updatedAt ?? createdAt });
  }
  return events.reverse();
}

export function toReportDetail(
  row: ReportDetailRow,
  votedByMe: boolean,
): ReportDetail {
  const reporter = first(row.reporter);
  const profile = first(reporter?.profile);
  const category = first(row.category);
  const status = toReportStatus(first(row.status)?.status_name);

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    location: row.location ?? '',
    brokenDate: row.broken_date,
    category: category
      ? { id: category.id, name: category.category_name ?? '' }
      : null,
    status,
    imageUrls: row.image_url ? [row.image_url] : [],
    reporter: {
      name:
        profile?.full_name?.trim() || reporter?.username?.trim() || 'Pengguna',
      role: toUserRole(first(reporter?.roles)?.role_name),
      className: profile?.class?.trim() || null,
      avatarUrl: profile?.profile_pict?.trim() || null,
    },
    createdAt: row.created_at,
    votes: first(row.reports_votes)?.count ?? 0,
    comments: first(row.reports_comments)?.count ?? 0,
    recommendations: first(row.recommendations)?.count ?? 0,
    votedByMe,
    verifiedBy: row.verified_by,
    rejectedBy: row.rejected_by,
    updatedBy: row.updated_by,
    timeline: buildTimeline(status, row.created_at, row.updated_at),
  };
}
