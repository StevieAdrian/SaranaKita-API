import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateReportDto } from './dto/create-report.dto';
import {
  ListReportsQueryDto,
  PopularReportsQueryDto,
} from './dto/list-reports.dto';
import { ReportFeedService } from './report-feed.service';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportFeedService: ReportFeedService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reportsService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListReportsQueryDto) {
    return this.reportFeedService.list(user, query);
  }

  @Get('popular')
  popular(
    @CurrentUser() user: AuthUser,
    @Query() query: PopularReportsQueryDto,
  ) {
    return this.reportFeedService.popular(user, query);
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
}
