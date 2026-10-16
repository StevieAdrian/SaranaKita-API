import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { USER_ROLES, type UserRole } from '../../../common/utils/resolve-role';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsIn(USER_ROLES)
  role: UserRole;

  @IsOptional()
  @IsString()
  classOrPosition?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
