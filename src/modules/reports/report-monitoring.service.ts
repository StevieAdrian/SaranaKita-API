import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import { REPORT_STATUSES, toReportStatus, type ReportStatus } from './report-feed.mapper';

type StatusRow = { id: string; status_name: string | null };

type MonitoringReportRow = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string | null;
  verified_by: string | null;
  rejected_by: string | null;
  updated_by: string | null;
  status: { status_name: string | null } | { status_name: string | null }[] | null;
};

export type RecentActivityType =
  | 'created'
  | 'voted'
  | 'recommended'
  | 'status_changed';

export type RecentActivity = {
  id: string;
  reportId: string;
  title: string;
  status: ReportStatus;
  date: string;
  activityType: RecentActivityType;
  description: string;
};

export type MonitoringStatistics = {
  total: number;
  completed: number;
  waitingVerification: number;
  inInspection: number;
  inRepair: number;
};

export type MonitoringResponse = {
  statistics: MonitoringStatistics;
  activities: RecentActivity[];
};

const MONITORING_SELECT = [
  'id',
  'title',
  'created_at',
  'updated_at',
  'verified_by',
  'rejected_by',
  'updated_by',
  'status(status_name)',
].join(', ');

const ACTIVITY_LIMIT = 10;

const STATUS_DESCRIPTION: Record<ReportStatus, string> = {
  waiting_verification: 'Laporan baru menunggu verifikasi.',
  in_review: 'Laporan sedang dalam pemeriksaan.',
  in_repair: 'Laporan sedang dalam proses perbaikan.',
  rejected: 'Laporan ditolak.',
  done: 'Laporan telah selesai ditangani.',
};

@Injectable()
export class ReportMonitoringService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async getMonitoring(user: AuthUser): Promise<MonitoringResponse> {
    const client = this.supabaseService.getAdminClient();
    const schoolId = user.role === 'administrator' ? null : await this.schoolMembership.getSchoolId(user.id);

    const scopedCount = () => {
      const query = client
        .from('report')
        .select('id', { count: 'exact', head: true })
        .eq('is_delete', false);
      return schoolId ? query.eq('school_id', schoolId) : query;
    };

    const statusResult = await client
      .from('status')
      .select('id, status_name');
    if (statusResult.error) throw statusResult.error;

    const idsByStatus = new Map<ReportStatus, string[]>(
      REPORT_STATUSES.map((status) => [status, []]),
    );
    for (const row of (statusResult.data ?? []) as StatusRow[]) {
      idsByStatus.get(toReportStatus(row.status_name))?.push(row.id);
    }

    const countByStatus = async (status: ReportStatus): Promise<number> => {
      const ids = idsByStatus.get(status) ?? [];
      const queries = ids.length ? [scopedCount().in('status_id', ids)] : [];
      if (status === 'waiting_verification') {
        queries.push(scopedCount().is('status_id', null));
      }
      const results = await Promise.all(queries);
      let total = 0;
      for (const result of results) {
        if (result.error) throw result.error;
        total += result.count ?? 0;
      }
      return total;
    };

    const [total, waitingVerification, inInspection, inRepair, completed] =
      await Promise.all([
        scopedCount(),
        countByStatus('waiting_verification'),
        countByStatus('in_review'),
        countByStatus('in_repair'),
        countByStatus('done'),
      ]);
    if (total.error) throw total.error;

    const statistics: MonitoringStatistics = {
      total: total.count ?? 0,
      completed,
      waitingVerification,
      inInspection,
      inRepair,
    };

    const activities = await this.getRecentActivities(schoolId);

    return { statistics, activities };
  }

  private async getRecentActivities(
    schoolId: string | null,
  ): Promise<RecentActivity[]> {
    const client = this.supabaseService.getAdminClient();
    let query = client
      .from('report')
      .select(MONITORING_SELECT)
      .eq('is_delete', false)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_LIMIT);
    if (schoolId) {
      query = query.eq('school_id', schoolId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as MonitoringReportRow[];
    return rows.map((row) => this.toActivity(row));
  }

  private toActivity(row: MonitoringReportRow): RecentActivity {
    const statusName = (Array.isArray(row.status) ? row.status[0] : row.status)?.status_name;
    const status = toReportStatus(statusName);
    const hasProgressed = status !== 'waiting_verification' || Boolean(row.verified_by || row.rejected_by);
    const activityType: RecentActivityType = hasProgressed ? 'status_changed' : 'created';
    const date = row.updated_at ?? row.created_at;

    return {
      id: row.id,
      reportId: row.id,
      title: row.title?.trim() || 'Laporan',
      status,
      date,
      activityType,
      description: activityType === 'created' ? 'Laporan baru dibuat.' : STATUS_DESCRIPTION[status],
    };
  }
}
