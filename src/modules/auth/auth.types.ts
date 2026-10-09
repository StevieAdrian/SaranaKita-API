export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserResponse {
  id: string;
  email: string;
  displayName: string;
}

export interface SignInResponse {
  tokens: AuthTokensResponse;
  user: AuthUserResponse;
}

export interface MeResponse {
  user: AuthUserResponse;
}
