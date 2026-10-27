import { Module } from '@nestjs/common';
import { ReportDetailService } from './report-detail.service';
import { ReportFeedService } from './report-feed.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportCommentsService } from './report-comments.service';
import { ReportDashboardService } from './report-dashboard.service';
import { ReportNotesService } from './report-notes.service';
import { ReportEvaluasiService } from './report-evaluasi.service';
import { ReportMonitoringService } from './report-monitoring.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportFeedService,
    ReportDetailService,
    ReportCommentsService,
    ReportDashboardService,
    ReportNotesService,
    ReportEvaluasiService,
    ReportMonitoringService,
  ],
})
export class ReportsModule {}
