import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import {
  REPORT_DETAIL_SELECT,
  toReportDetail,
  type ReportDetail,
  type ReportDetailRow,
} from './report-detail.mapper';

@Injectable()
export class ReportDetailService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async findOne(user: AuthUser, reportId: string): Promise<ReportDetail> {
    const schoolId = await this.schoolMembership.getSchoolId(user.id);
    const client = this.supabaseService.getAdminClient();

    const [report, myVote] = await Promise.all([
      client
        .from('report')
        .select(REPORT_DETAIL_SELECT)
        .eq('id', reportId)
        .eq('school_id', schoolId)
        .maybeSingle(),
      client
        .from('reports_votes')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)
        .eq('user_id', user.id),
    ]);

    if (report.error) {
      throw report.error;
    }
    if (myVote.error) {
      throw myVote.error;
    }
    if (!report.data) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }

    return toReportDetail(
      report.data as unknown as ReportDetailRow,
      (myVote.count ?? 0) > 0,
    );
  }
}
