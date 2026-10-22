import { Injectable, NotFoundException } from '@nestjs/common';
import type { PaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import type {
  ListReportsQueryDto,
  PopularReportsQueryDto,
} from './dto/list-reports.dto';
import {
  toFeedReport,
  toReportStatus,
  toSearchTerm,
  type FeedReport,
  type FeedReportRow,
  type ReportStatus,
  type VoteResult,
} from './report-feed.mapper';
import { compareFeedReports, DB_SORTS } from './report-feed.sort';

const FEED_SELECT = [
  'id',
  'reporter_id',
  'title',
  'description',
  'location',
  'category_id',
  'image_url',
  'created_at',
  'verified_by',
  'rejected_by',
  'updated_by',
  'status(status_name)',
  'reporter:user!report_reporter_id_fkey(username, profile(full_name, class))',
  'reports_votes(count)',
  'reports_comments(count)',
  'recommendations(count)',
].join(', ');

const POPULAR_CANDIDATES = 200;
const SORT_CANDIDATES = 500;
const INITIAL_RECOMMENDATION_STATUS = 'Menunggu Verifikasi';

@Injectable()
export class ReportFeedService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async list(
    user: AuthUser,
    query: ListReportsQueryDto,
  ): Promise<PaginatedResult<FeedReport>> {
    const schoolId =
      user.role === 'administrator'
        ? null
        : await this.schoolMembership.getSchoolId(user.id);
    const { page, limit } = query;
    const sort = query.sort ?? 'latest';
    const from = (page - 1) * limit;
    const empty = { items: [], total: 0, page, limit, totalPages: 0 };

    let builder = this.supabaseService
      .getAdminClient()
      .from('report')
      .select(FEED_SELECT, { count: 'exact' });

    if (schoolId) {
      builder = builder.eq('school_id', schoolId);
    }

    if (query.categoryId) {
      builder = builder.eq('category_id', query.categoryId);
    }

    const term = toSearchTerm(query.search);
    if (term) {
      const pattern = `%${term}%`;
      builder = builder.or(
        `title.ilike.${pattern},description.ilike.${pattern},location.ilike.${pattern}`,
      );
    }

    if (query.status?.length) {
      const statusFilter = await this.toStatusFilter(query.status);
      if (!statusFilter) {
        return empty;
      }
      builder = builder.or(statusFilter);
    }

    const ordered = builder.order('created_at', {
      ascending: sort === 'oldest',
    });
    const isDbSort = DB_SORTS.includes(sort);
    const { data, count, error } = isDbSort
      ? await ordered.range(from, from + limit - 1)
      : await ordered.limit(SORT_CANDIDATES);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as unknown as FeedReportRow[];
    const total = count ?? 0;

    if (isDbSort) {
      const items = await this.withUserActions(user.id, user.role, rows);
      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const pageRows = rows
      .map((row) => toFeedReport(row, false))
      .sort(compareFeedReports(sort))
      .slice(from, from + limit)
      .map((report) => byId.get(report.id))
      .filter((row): row is FeedReportRow => row !== undefined);
    const items = await this.withUserActions(user.id, user.role, pageRows);
    const capped = Math.min(total, SORT_CANDIDATES);

    return {
      items,
      total: capped,
      page,
      limit,
      totalPages: Math.ceil(capped / limit),
    };
  }

  private async toStatusFilter(
    statuses: readonly ReportStatus[],
  ): Promise<string | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('status')
      .select('id, status_name');

    if (error) {
      throw error;
    }

    const wanted = new Set(statuses);
    const ids = ((data ?? []) as { id: string; status_name: string | null }[])
      .filter((row) => wanted.has(toReportStatus(row.status_name)))
      .map((row) => row.id);

    const parts: string[] = [];
    if (ids.length > 0) {
      parts.push(`status_id.in.(${ids.join(',')})`);
    }
    if (wanted.has('waiting_verification')) {
      parts.push('status_id.is.null');
    }
    return parts.length > 0 ? parts.join(',') : null;
  }

  async popular(
    user: AuthUser,
    query: PopularReportsQueryDto,
  ): Promise<FeedReport[]> {
    const schoolId = await this.schoolMembership.getSchoolId(user.id);

    let builder = this.supabaseService
      .getAdminClient()
      .from('report')
      .select(FEED_SELECT)
      .eq('school_id', schoolId);

    if (query.categoryId) {
      builder = builder.eq('category_id', query.categoryId);
    }

    const { data, error } = await builder
      .order('created_at', { ascending: false })
      .limit(POPULAR_CANDIDATES);

    if (error) {
      throw error;
    }

    const items = await this.withUserActions(
      user.id,
      user.role,
      (data ?? []) as unknown as FeedReportRow[],
    );

    return items
      .filter((item) => item.votes > 0)
      .sort(
        (a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, query.limit);
  }

  async vote(user: AuthUser, reportId: string): Promise<VoteResult> {
    await this.assertReportInUserSchool(user.id, reportId);
    const client = this.supabaseService.getAdminClient();

    const { data: existing, error: findError } = await client
      .from('reports_votes')
      .select('id')
      .eq('report_id', reportId)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (!existing) {
      const { error } = await client
        .from('reports_votes')
        .insert({ report_id: reportId, user_id: user.id });
      if (error) {
        throw error;
      }
    }

    return this.voteResult(user.id, reportId);
  }

  async unvote(user: AuthUser, reportId: string): Promise<VoteResult> {
    await this.assertReportInUserSchool(user.id, reportId);

    const { error } = await this.supabaseService
      .getAdminClient()
      .from('reports_votes')
      .delete()
      .eq('report_id', reportId)
      .eq('user_id', user.id);

    if (error) {
      throw error;
    }

    return this.voteResult(user.id, reportId);
  }

  async recommend(
    user: AuthUser,
    reportId: string,
    reason: string,
  ): Promise<RecommendationResult> {
    await this.assertReportInUserSchool(user.id, reportId);
    const client = this.supabaseService.getAdminClient();
    const { data: existing, error: findError } = await client
      .from('recommendations')
      .select('id')
      .eq('report_id', reportId)
      .eq('guru_id', user.id)
      .limit(1)
      .maybeSingle();

    if (findError) {
      throw findError;
    }
    if (existing) {
      const { error } = await client
        .from('recommendations')
        .update({ reason })
        .eq('report_id', reportId)
        .eq('guru_id', user.id);
      if (error) {
        throw error;
      }
    } else {
      const statusId = await this.getRecommendationStatusId();
      const { error } = await client.from('recommendations').insert({
        report_id: reportId,
        guru_id: user.id,
        status_id: statusId,
        reason,
      });
      if (error) {
        throw error;
      }
    }
    return this.recommendationResult(user.id, reportId);
  }

  async removeRecommendation(
    user: AuthUser,
    reportId: string,
  ): Promise<RecommendationResult> {
    await this.assertReportInUserSchool(user.id, reportId);
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('recommendations')
      .delete()
      .eq('report_id', reportId)
      .eq('guru_id', user.id);

    if (error) {
      throw error;
    }
    return this.recommendationResult(user.id, reportId);
  }

  private async withUserActions(
    userId: string,
    role: AuthUser['role'],
    rows: FeedReportRow[],
  ): Promise<FeedReport[]> {
    if (rows.length === 0) {
      return [];
    }

    const client = this.supabaseService.getAdminClient();
    const reportIds = rows.map((row) => row.id);
    const [votes, recommendations] = await Promise.all([
      client
        .from('reports_votes')
        .select('report_id')
        .eq('user_id', userId)
        .in('report_id', reportIds),
      role === 'guru'
        ? client
            .from('recommendations')
            .select('report_id')
            .eq('guru_id', userId)
            .in('report_id', reportIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (votes.error) {
      throw votes.error;
    }
    if (recommendations.error) {
      throw recommendations.error;
    }

    const voted = new Set(
      ((votes.data ?? []) as { report_id: string }[]).map(
        (row) => row.report_id,
      ),
    );
    const recommended = new Set(
      ((recommendations.data ?? []) as { report_id: string }[]).map(
        (row) => row.report_id,
      ),
    );
    return rows.map((row) =>
      toFeedReport(row, voted.has(row.id), recommended.has(row.id)),
    );
  }

  private async assertReportInUserSchool(
    userId: string,
    reportId: string,
  ): Promise<void> {
    const schoolId = await this.schoolMembership.getSchoolId(userId);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('report')
      .select('id')
      .eq('id', reportId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }
  }

  private async getRecommendationStatusId(): Promise<string> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('status')
      .select('id')
      .eq('status_name', INITIAL_RECOMMENDATION_STATUS)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new NotFoundException(
        `Status "${INITIAL_RECOMMENDATION_STATUS}" belum tersedia.`,
      );
    }
    return (data as { id: string }).id;
  }

  private async voteResult(
    userId: string,
    reportId: string,
  ): Promise<VoteResult> {
    const client = this.supabaseService.getAdminClient();
    const [total, mine] = await Promise.all([
      client
        .from('reports_votes')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId),
      client
        .from('reports_votes')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)
        .eq('user_id', userId),
    ]);

    if (total.error) {
      throw total.error;
    }
    if (mine.error) {
      throw mine.error;
    }

    return {
      reportId,
      votes: total.count ?? 0,
      votedByMe: (mine.count ?? 0) > 0,
    };
  }

  private async recommendationResult(
    userId: string,
    reportId: string,
  ): Promise<RecommendationResult> {
    const client = this.supabaseService.getAdminClient();
    const [total, mine] = await Promise.all([
      client
        .from('recommendations')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId),
      client
        .from('recommendations')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)
        .eq('guru_id', userId),
    ]);

    if (total.error) throw total.error;
    if (mine.error) throw mine.error;
    return {
      reportId,
      recommendations: total.count ?? 0,
      recommendedByMe: (mine.count ?? 0) > 0,
    };
  }
}

export type RecommendationResult = {
  reportId: string;
  recommendations: number;
  recommendedByMe: boolean;
};
