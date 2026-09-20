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

  // R2 bucket holding the originals (wrangler [[r2_buckets]] binding = "ORIGINALS").
  // Structural so the Node test config compiles without workers-types.
  ORIGINALS: {
    put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer>; size: number; httpMetadata?: { contentType?: string } } | null>;
    delete(key: string): Promise<void>;
  };

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
