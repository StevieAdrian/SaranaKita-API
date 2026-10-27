import { Injectable, InternalServerErrorException } from '@nestjs/common';

import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';

import { mapMonitoringActivity } from './report-monitoring.mapper';

import type {
  ReportMonitoringActivityDto,
  ReportMonitoringResponseDto,
  ReportMonitoringStatisticsDto,
} from './dto/report-monitoring.dto';

import type { MonitoringReportRow } from './report-monitoring.mapper';

type ActivityRow = {
  report_id: string;
  created_at: string;
};

@Injectable()
export class ReportMonitoringService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async getMonitoring(user: AuthUser): Promise<ReportMonitoringResponseDto> {
    const client = this.supabaseService.getAdminClient();

    const userSchool =
      user.role === 'administrator'
        ? null
        : await this.schoolMembership.getSchool(user.id);

    let reportsQuery = client
      .from('report')
      .select('id,title,created_at,reporter_id,school_id,status(status_name)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (userSchool) {
      reportsQuery = reportsQuery.eq('school_id', userSchool.id);
    }

    const { data: reportData, error: reportError } = await reportsQuery;

    if (reportError) {
      throw new InternalServerErrorException(
        'Gagal mengambil data monitoring laporan',
      );
    }

    const reports = (reportData ?? []) as unknown as MonitoringReportRow[];
    const reportMap = new Map(reports.map((report) => [report.id, report]));

    const statistics: ReportMonitoringStatisticsDto = {
      total: reports.length,
      completed: 0,
      waitingVerification: 0,
      inInspection: 0,
      inRepair: 0,
    };

    for (const report of reports) {
      const rawStatus = Array.isArray(report.status)
        ? report.status[0]?.status_name
        : report.status?.status_name;

      const status = (rawStatus ?? '')
        .toLowerCase()
        .trim()
        .replace(/[\s-]+/g, '_');

      if (status === 'done' || status === 'selesai') {
        statistics.completed++;
      } else if (
        !status ||
        status.includes('waiting_verification') ||
        status.includes('menunggu_verifikasi')
      ) {
        statistics.waitingVerification++;
      } else if (
        status === 'in_review' ||
        status.includes('inspection') ||
        status.includes('pemeriksaan')
      ) {
        statistics.inInspection++;
      } else if (
        status.includes('in_repair') ||
        status.includes('repair') ||
        status.includes('perbaikan')
      ) {
        statistics.inRepair++;
      }
    }

    const activities: ReportMonitoringActivityDto[] = [];

    // Aktivitas pembuatan laporan
    const createdReports =
      user.role === 'administrator'
        ? reports
        : reports.filter((report) => report.reporter_id === user.id);

    for (const report of createdReports) {
      activities.push(
        mapMonitoringActivity(report, 'created', report.created_at),
      );
    }

    // Aktivitas dukungan siswa
    if (user.role === 'siswa' || user.role === 'administrator') {
      let votesQuery = client
        .from('reports_votes')
        .select('report_id,created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (user.role === 'siswa') {
        votesQuery = votesQuery.eq('user_id', user.id);
      }

      const { data: votes, error: votesError } = await votesQuery;

      if (votesError) {
        throw new InternalServerErrorException(
          'Gagal mengambil aktivitas dukungan',
        );
      }

      for (const vote of (votes ?? []) as ActivityRow[]) {
        const report = reportMap.get(vote.report_id);

        if (report) {
          activities.push(
            mapMonitoringActivity(report, 'voted', vote.created_at),
          );
        }
      }
    }

    // Aktivitas rekomendasi gur
    if (user.role === 'guru' || user.role === 'administrator') {
      let recommendationsQuery = client
        .from('recommendations')
        .select('report_id,created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (user.role === 'guru') {
        recommendationsQuery = recommendationsQuery.eq('guru_id', user.id);
      }

      const { data: recommendations, error: recommendationsError } =
        await recommendationsQuery;

      if (recommendationsError) {
        throw new InternalServerErrorException(
          'Gagal mengambil aktivitas rekomendasi',
        );
      }

      for (const recommendation of (recommendations ?? []) as ActivityRow[]) {
        const report = reportMap.get(recommendation.report_id);

        if (report) {
          activities.push(
            mapMonitoringActivity(
              report,
              'recommended',
              recommendation.created_at,
            ),
          );
        }
      }
    }

    activities.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return {
      statistics,
      activities: activities.slice(0, 10),
    };
  }
}
