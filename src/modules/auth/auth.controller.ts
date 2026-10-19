import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AuthService } from './auth.service';
import { DevRoleService } from './dev-role.service';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { SwitchRoleDto } from './dto/switch-role.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly devRoleService: DevRoleService,
  ) { }

  @Public()
  @Get('check-username')
  checkUsername(@Query('username') username: string) {
    return this.authService.checkUsername(username || '');
  }

  @Public()
  @Get('check-email')
  checkEmail(@Query('email') email: string) {
    return this.authService.checkEmail(email || '');
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }

  @Post('dev/switch-role')
  @HttpCode(HttpStatus.OK)
  switchRole(@CurrentUser() user: AuthUser, @Body() dto: SwitchRoleDto) {
    return this.devRoleService.switchRole(user, dto);
  }
}
