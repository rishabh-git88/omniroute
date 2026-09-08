export const AUTH_ENVIRONMENT = Symbol('AUTH_ENVIRONMENT');

export const GOOGLE_IDENTITY_PROVIDER = 'google';

export const OAUTH_COOKIE_NAMES = {
  codeVerifier: 'omniroute_oauth_code_verifier',
  nonce: 'omniroute_oauth_nonce',
  returnTo: 'omniroute_oauth_return_to',
  state: 'omniroute_oauth_state',
} as const;

export const PUBLIC_ROUTE = 'omniroute:public-route';
