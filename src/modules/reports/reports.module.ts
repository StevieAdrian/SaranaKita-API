import { Module } from '@nestjs/common';
import { ReportDetailService } from './report-detail.service';
import { ReportFeedService } from './report-feed.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportCommentsService } from './report-comments.service';
import { ReportDashboardService } from './report-dashboard.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportFeedService,
    ReportDetailService,
    ReportCommentsService,
    ReportDashboardService,
  ],
})
export class ReportsModule {}
