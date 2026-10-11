import type { UserRole } from '../utils/resolve-role';

export interface AuthUser {
  id: string;
  email?: string;
  role?: UserRole | null;
  [key: string]: unknown;
}
