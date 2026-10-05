import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAccountRequest } from './_accountScope.js';

export function withAccountScope<T>(handler: (req: VercelRequest, res: VercelResponse) => T) {
  return (req: VercelRequest, res: VercelResponse): T => runAccountRequest(() => handler(req, res));
}
