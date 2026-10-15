import { Module } from '@nestjs/common';
import { ReportDetailService } from './report-detail.service';
import { ReportFeedService } from './report-feed.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportCommentsService } from './report-comments.service';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportFeedService,
    ReportDetailService,
    ReportCommentsService,
  ],
})
export class ReportsModule {}
