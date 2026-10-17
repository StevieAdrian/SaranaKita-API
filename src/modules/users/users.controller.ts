import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('myprofile')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.usersService.findOne(user.id);
  }

  @Get('summary')
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  getSummary() {
    return this.usersService.getSummary();
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  findAll(@Query() query: PaginationQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('administrator', 'staff')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
