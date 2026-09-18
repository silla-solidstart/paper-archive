export interface Env {
  // Config (wrangler.toml [vars])
  GCP_PROJECT_ID: string;
  GCP_PROJECT_NUMBER: string;
  GCP_DOCAI_LOCATION: string;
  GCP_DOCAI_PROCESSOR_ID: string;
  GCP_DOCAI_PROCESSOR_VERSION: string;
  GOOGLE_OAUTH_REDIRECT_URI: string;

  // Secrets
  APP_BEARER_TOKEN: string;
  GCP_SA_CLIENT_EMAIL: string;
  GCP_SA_PRIVATE_KEY: string;
  ANTHROPIC_API_KEY: string;
  DATABASE_URL: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
}
