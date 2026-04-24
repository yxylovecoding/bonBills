import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const secret = (process.env.SYNC_SECRET || '').trim();
  return res.status(200).json({
    secret_set: !!secret,
    secret_length: secret.length,
    kv_url_set: !!process.env.KV_REST_API_URL,
    kv_token_set: !!process.env.KV_REST_API_TOKEN,
  });
}
