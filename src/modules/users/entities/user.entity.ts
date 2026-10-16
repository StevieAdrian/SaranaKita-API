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
}
