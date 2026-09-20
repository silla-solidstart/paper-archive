export interface Env {
  // Config (wrangler.toml [vars])
  GCP_PROJECT_ID: string;
  GCP_PROJECT_NUMBER: string;
  GCP_DOCAI_LOCATION: string;
  GCP_DOCAI_PROCESSOR_ID: string;
  GCP_DOCAI_PROCESSOR_VERSION: string;
  GOOGLE_OAUTH_REDIRECT_URI: string;
  // Bootstrap admins (config, not secret): always allowed, always admin.
  ADMIN_EMAILS: string;

  // Static assets binding (wrangler [assets] binding = "ASSETS"); the Worker
  // fronts every request and serves the app only to an allowed session.
  ASSETS: { fetch(request: Request): Promise<Response> };

  // Secrets
  APP_BEARER_TOKEN: string;
  SESSION_SECRET: string;
  GCP_SA_CLIENT_EMAIL: string;
  GCP_SA_PRIVATE_KEY: string;
  ANTHROPIC_API_KEY: string;
  DATABASE_URL: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
}
