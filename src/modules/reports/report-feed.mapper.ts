export const REPORT_STATUSES = [
  'waiting_verification',
  'in_review',
  'in_repair',
  'rejected',
  'done',
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

const STATUS_ALIASES: Record<string, ReportStatus> = {
  waiting_verification: 'waiting_verification',
  'menunggu verifikasi': 'waiting_verification',
  in_review: 'in_review',
  'dalam pemeriksaan': 'in_review',
  in_repair: 'in_repair',
  'dalam perbaikan': 'in_repair',
  rejected: 'rejected',
  ditolak: 'rejected',
  done: 'done',
  selesai: 'done',
};

export function toReportStatus(name: unknown): ReportStatus {
  if (typeof name !== 'string') {
    return 'waiting_verification';
  }
  return STATUS_ALIASES[name.trim().toLowerCase()] ?? 'waiting_verification';
}

type Related<T> = T | T[] | null | undefined;

export type FeedReportRow = {
  id: string;
  reporter_id: string;
  title: string;
  description: string | null;
  location: string | null;
  category_id: string | null;
  image_url: string | null;
  created_at: string;
  status: Related<{ status_name: string | null }>;
  reporter: Related<{
    username: string | null;
    profile: Related<{ full_name: string | null; class: string | null }>;
  }>;
  reports_votes: Related<{ count: number }>;
  reports_comments: Related<{ count: number }>;
  recommendations: Related<{ count: number }>;
  reports_notes: Related<{
    id: string;
    author_id: string;
    note_text: string | null;
    created_at: string;
  }>;
};

export type FeedReport = {
  id: string;
  reporter_id: string;
  title: string;
  description: string;
  location: string;
  categoryId: string | null;
  status: ReportStatus;
  imageUrl: string | null;
  reporterName: string;
  reporterClass: string | null;
  createdAt: string;
  votes: number;
  comments: number;
  recommendations: number;
  votedByMe: boolean;
  recommendedByMe: boolean;
  note: {
    id: string;
    authorId: string;
    text: string;
    createdAt: string;
  } | null;
};

export type VoteResult = {
  reportId: string;
  votes: number;
  votedByMe: boolean;
};

function first<T>(value: Related<T>): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export function toFeedReport(
  row: FeedReportRow,
  votedByMe: boolean,
  recommendedByMe = false,
): FeedReport {
  const reporter = first(row.reporter);
  const profile = first(reporter?.profile);
  return {
    id: row.id,
    reporter_id: row.reporter_id,
    title: row.title,
    description: row.description ?? '',
    location: row.location ?? '',
    categoryId: row.category_id,
    status: toReportStatus(first(row.status)?.status_name),
    imageUrl: row.image_url,
    reporterName:
      profile?.full_name?.trim() || reporter?.username?.trim() || 'Pengguna',
    reporterClass: profile?.class?.trim() || null,
    createdAt: row.created_at,
    votes: first(row.reports_votes)?.count ?? 0,
    comments: first(row.reports_comments)?.count ?? 0,
    recommendations: first(row.recommendations)?.count ?? 0,
    votedByMe,
    recommendedByMe,
    note: (() => {
      const note = first(row.reports_notes);

      if (!note) {
        return null;
      }

      return {
        id: note.id,
        authorId: note.author_id,
        text: note.note_text ?? '',
        createdAt: note.created_at,
      };
    })(),
  };
}

export function toSearchTerm(search: string | undefined): string | null {
  const cleaned = (search ?? '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

//untuk report notes
