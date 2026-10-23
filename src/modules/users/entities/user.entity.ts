import type { UserRole } from '../../../common/utils/resolve-role';

export interface UserEntity {
  id: string;
  username: string | null;
  email: string;
  fullName: string | null;
  role: UserRole | null;
  isVerified: boolean;
  createdAt: string;
  classOrPosition?: string | null;
  avatarUrl?: string | null;
  status?: string;
  isActive?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  isDelete?: boolean;
}
