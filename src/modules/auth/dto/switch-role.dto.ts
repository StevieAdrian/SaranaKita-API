import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { USER_ROLES, type UserRole } from '../../../common/utils/resolve-role';

export class SwitchRoleDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsIn(USER_ROLES)
  role: UserRole;
}
