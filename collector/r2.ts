/**
 * Minimal Cloudflare R2 client (S3 API, AWS Signature Version 4) on node:crypto and fetch: PUT and DELETE of single
 * objects, which is all the publisher needs. No dependency. Credentials come from the environment and are never
 * logged.
 */
import { createHash, createHmac } from "node:crypto";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** R2 settings from the environment (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET), or null. */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return { accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET };
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** S3 URI encoding of an object key (every byte except unreserved characters and "/"). */
export function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export interface SignInput {
  method: string;
  host: string;
  /** Already URI-encoded path, starting with "/". */
  path: string;
  /** Headers to sign (besides host); x-amz-date and x-amz-content-sha256 are added. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date: Date;
}

/** AWS Signature Version 4 headers for a request without a query string. */
export function signV4(input: SignInput): Record<string, string> {
  const amzDate = input.date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [input.method, input.path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const out: Record<string, string> = { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
  delete out.host; // fetch sets Host itself (the same value)
  return out;
}

async function send(cfg: R2Config, method: "PUT" | "DELETE", key: string, body?: Buffer, extra: Record<string, string> = {}): Promise<void> {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const path = `/${encodeKey(cfg.bucket)}/${encodeKey(key)}`;
  for (let attempt = 1; ; attempt++) {
    const headers = signV4({ method, host, path, headers: extra, payloadHash: sha256Hex(body ?? ""), accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: "auto", service: "s3", date: new Date() });
    try {
      const res = await fetch(`https://${host}${path}`, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(60_000) });
      if (res.ok || (method === "DELETE" && res.status === 404)) return;
      const text = (await res.text()).slice(0, 200);
      if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`R2 ${method} ${key}: HTTP ${res.status} ${text}`);
    } catch (error) {
      if (attempt >= 4) throw error;
    }
    await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
  }
}

export function putObject(cfg: R2Config, key: string, body: Buffer, headers: Record<string, string>): Promise<void> {
  return send(cfg, "PUT", key, body, headers);
}

export function deleteObject(cfg: R2Config, key: string): Promise<void> {
  return send(cfg, "DELETE", key);
}
