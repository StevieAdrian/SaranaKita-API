import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateReportDto } from './dto/create-report.dto';
import { CreateReportCommentDto } from './dto/create-report-comment.dto';
import { CreateReportRecommendationDto } from './dto/create-report-recommendation.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import {
  ListReportsQueryDto,
  PopularReportsQueryDto,
} from './dto/list-reports.dto';
import { ReportDetailService } from './report-detail.service';
import { ReportFeedService } from './report-feed.service';
import { ReportCommentsService } from './report-comments.service';
import { ReportsService } from './reports.service';
import { ReportDashboardService } from './report-dashboard.service';
import { UpdateReportDto } from './dto/update-report.dto';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportFeedService: ReportFeedService,
    private readonly reportDetailService: ReportDetailService,
    private readonly reportCommentsService: ReportCommentsService,
    private readonly reportDashboardService: ReportDashboardService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reportsService.create(user, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('siswa', 'guru')
  list(@CurrentUser() user: AuthUser, @Query() query: ListReportsQueryDto) {
    return this.reportFeedService.list(user, query);
  }

  @Get('popular')
  @UseGuards(RolesGuard)
  @Roles('siswa', 'guru')
  popular(
    @CurrentUser() user: AuthUser,
    @Query() query: PopularReportsQueryDto,
  ) {
    return this.reportFeedService.popular(user, query);
  }

  @Get('dashboard')
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.reportDashboardService.getDashboard(user);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportStatusDto,
  ) {
    return this.reportDetailService.updateStatus(user, id, dto);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('siswa', 'guru', 'administrator', 'staff')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reportDetailService.findOne(user, id);
  }

  @Get(':id/comments')
  @UseGuards(RolesGuard)
  @Roles('siswa', 'guru', 'administrator', 'staff')
  listComments(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reportCommentsService.list(user, id);
  }

  @Post(':id/comments')
  @UseGuards(RolesGuard)
  @Roles('siswa')
  createComment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReportCommentDto,
  ) {
    return this.reportCommentsService.create(user, id, dto);
  }

  @Post(':id/recommendations')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('guru')
  recommend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReportRecommendationDto,
  ) {
    return this.reportFeedService.recommend(user, id, dto.reason);
  }

  @Delete(':id/recommendations')
  @UseGuards(RolesGuard)
  @HttpCode(HttpStatus.OK)
  @Roles('guru')
  removeRecommendation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reportFeedService.removeRecommendation(user, id);
  }

  @Post(':id/votes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('siswa')
  vote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reportFeedService.vote(user, id);
  }

  @Delete(':id/votes')
  @UseGuards(RolesGuard)
  @Roles('siswa')
  unvote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reportFeedService.unvote(user, id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('siswa')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reportsService.update(user, id, dto);
  }
}
