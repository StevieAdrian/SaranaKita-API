import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import {
  REPORT_STATUSES,
  toFeedReport,
  toReportStatus,
  type FeedReport,
  type FeedReportRow,
  type ReportStatus,
} from './report-feed.mapper';

type StatusRow = { id: string; status_name: string | null };
type CategoryRow = { id: string; category_name: string | null };
type SchoolRow = { school_name: string | null };

const DASHBOARD_REPORT_SELECT = [
  'id',
  'title',
  'description',
  'location',
  'category_id',
  'image_url',
  'created_at',
  'status(status_name)',
  'reporter:user!report_reporter_id_fkey(username, profile(full_name, class))',
  'reports_votes(count)',
  'reports_comments(count)',
  'recommendations(count)',
].join(', ');

export type ReportDashboard = {
  generatedAt: string;
  schoolName: string | null;
  totalReports: number;
  totalThisMonth: number;
  statusCounts: Record<ReportStatus, number>;
  categories: { id: string; name: string; count: number }[];
  urgentReports: FeedReport[];
};

@Injectable()
export class ReportDashboardService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async getDashboard(user: AuthUser): Promise<ReportDashboard> {
    const client = this.supabaseService.getAdminClient();
    const userSchool =
      user.role === 'administrator'
        ? null
        : await this.schoolMembership.getSchool(user.id);
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();

    const countReports = () => {
      const query = client
        .from('report')
        .select('id', { count: 'exact', head: true });
      return userSchool ? query.eq('school_id', userSchool.id) : query;
    };
    const [statusResult, categoryResult, totalResult, monthResult] =
      await Promise.all([
        client.from('status').select('id, status_name'),
        client.from('category').select('id, category_name'),
        countReports(),
        countReports().gte('created_at', monthStart),
      ]);
    const schoolResult = userSchool
      ? null
      : await client.from('school').select('school_name').limit(1).maybeSingle();

    if (statusResult.error) throw statusResult.error;
    if (categoryResult.error) throw categoryResult.error;
    if (schoolResult?.error) throw schoolResult.error;
    if (totalResult.error) throw totalResult.error;
    if (monthResult.error) throw monthResult.error;

    const statuses = (statusResult.data ?? []) as StatusRow[];
    const categories = (categoryResult.data ?? []) as CategoryRow[];
    const idsByStatus = new Map<ReportStatus, string[]>(
      REPORT_STATUSES.map((status) => [status, []]),
    );
    for (const status of statuses) {
      idsByStatus.get(toReportStatus(status.status_name))?.push(status.id);
    }

    const statusCounts = {} as Record<ReportStatus, number>;
    await Promise.all(
      REPORT_STATUSES.map(async (status) => {
        const ids = idsByStatus.get(status) ?? [];
        const queries = ids.length
          ? [countReports().in('status_id', ids)]
          : [];
        if (status === 'waiting_verification') {
          queries.push(countReports().is('status_id', null));
        }
        const results = await Promise.all(queries);
        for (const result of results) {
          if (result.error) throw result.error;
        }
        statusCounts[status] = results.reduce(
          (total, result) => total + (result.count ?? 0),
          0,
        );
      }),
    );

    const categoryCounts = await Promise.all(
      categories.map(async (category) => {
        const { count, error } = await countReports().eq(
          'category_id',
          category.id,
        );
        if (error) throw error;
        return {
          id: category.id,
          name: category.category_name ?? 'Tanpa nama',
          count: count ?? 0,
        };
      }),
    );

    const waitingIds = idsByStatus.get('waiting_verification') ?? [];
    const urgentQuery = client
      .from('report')
      .select(DASHBOARD_REPORT_SELECT)
      .order('created_at', { ascending: false })
      .limit(3)
      .or(
        waitingIds.length
          ? `status_id.is.null,status_id.in.(${waitingIds.join(',')})`
          : 'status_id.is.null',
      );
    if (userSchool) urgentQuery.eq('school_id', userSchool.id);

    const { data: urgentRows, error: urgentError } = await urgentQuery;
    if (urgentError) throw urgentError;

    return {
      generatedAt: now.toISOString(),
      schoolName: userSchool
        ? userSchool.name
        : (schoolResult?.data as SchoolRow | null)?.school_name ?? null,
      totalReports: totalResult.count ?? 0,
      totalThisMonth: monthResult.count ?? 0,
      statusCounts,
      categories: categoryCounts,
      urgentReports: ((urgentRows ?? []) as unknown as FeedReportRow[]).map(
        (row) => toFeedReport(row, false),
      ),
    };
  }
}
