import type { UserRole } from '../../common/utils/resolve-role';

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserResponse {
  id: string;
  email: string;
  username?: string;
  displayName: string;
  role: UserRole | null;
}

export interface SignInResponse {
  tokens: AuthTokensResponse;
  user: AuthUserResponse;
}

export interface MeResponse {
  user: AuthUserResponse;
}
