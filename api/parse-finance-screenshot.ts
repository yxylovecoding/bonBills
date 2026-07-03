import type { VercelRequest, VercelResponse } from '@vercel/node';

type ScreenshotMode = 'accounts' | 'investments' | 'auto';

function authOk(req: VercelRequest): boolean {
  const secret = (process.env.SYNC_SECRET || '').trim();
  if (!secret) return false;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/);
  return match !== null && match[1].trim() === secret;
}

function parseBody(req: VercelRequest): { imageDataUrl?: string; mode?: ScreenshotMode } {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return body && typeof body === 'object' ? body : {};
}

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const parseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'totals', 'accounts', 'investHoldings', 'usStockHoldings', 'recognizedRows', 'notes'],
  properties: {
    mode: { type: 'string', enum: ['accounts', 'investments', 'mixed', 'unknown'] },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['netAssetsCny', 'totalAssetsCny', 'liabilitiesCny', 'investTotalCny', 'investProfitCny'],
      properties: {
        netAssetsCny: nullableNumber,
        totalAssetsCny: nullableNumber,
        liabilitiesCny: nullableNumber,
        investTotalCny: nullableNumber,
        investProfitCny: nullableNumber,
      },
    },
    accounts: {
      type: 'object',
      additionalProperties: false,
      required: [
        'credit', 'creditMonthly', 'savingsCard', 'incomeBank', 'livingBank', 'campusCard',
        'consumptionBank', 'wishJar', 'investCnyBank', 'usdLivingBank', 'usdConsumptionBank',
        'usdWishJar', 'investUsdBank',
      ],
      properties: {
        credit: nullableNumber,
        creditMonthly: nullableNumber,
        savingsCard: nullableNumber,
        incomeBank: nullableNumber,
        livingBank: nullableNumber,
        campusCard: nullableNumber,
        consumptionBank: nullableNumber,
        wishJar: nullableNumber,
        investCnyBank: nullableNumber,
        usdLivingBank: nullableNumber,
        usdConsumptionBank: nullableNumber,
        usdWishJar: nullableNumber,
        investUsdBank: nullableNumber,
      },
    },
    investHoldings: {
      type: 'object',
      additionalProperties: false,
      required: ['us', 'eu', 'asia', 'a', 'longBond', 'usBond', 'gold'],
      properties: {
        us: nullableNumber,
        eu: nullableNumber,
        asia: nullableNumber,
        a: nullableNumber,
        longBond: nullableNumber,
        usBond: nullableNumber,
        gold: nullableNumber,
      },
    },
    usStockHoldings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'symbol', 'amount', 'currency', 'confidence'],
        properties: {
          name: { type: 'string' },
          symbol: nullableString,
          amount: { type: 'number' },
          currency: { type: 'string', enum: ['CNY', 'USD', 'UNKNOWN'] },
          confidence: { type: 'number' },
        },
      },
    },
    recognizedRows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'name', 'amount', 'currency', 'mappedTo', 'confidence'],
        properties: {
          section: { type: 'string' },
          name: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string', enum: ['CNY', 'USD', 'UNKNOWN'] },
          mappedTo: nullableString,
          confidence: { type: 'number' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

function promptFor(mode: ScreenshotMode): string {
  return [
    '你是个人财务 App 截图 OCR 与结构化导入助手。只读取截图中明确可见的金额，不要推测隐藏/遮挡内容。',
    `本次用户期望识别：${mode === 'accounts' ? '账户余额截图' : mode === 'investments' ? '理财持仓截图' : '自动判断截图类型'}。`,
    '所有人民币金额用 CNY 数字，美元金额用 USD 数字。保留负号；但 credit/creditMonthly 表示待还债务时用正数。',
    '账户截图映射规则：生活分组总额 -> livingBank；消费分组总额 -> consumptionBank；收入分组总额 -> incomeBank；校园卡行 -> campusCard；债务/应付 -> credit；可见“待还/本期待还” -> creditMonthly；投资/理财现金账户只映射到 investCnyBank/investUsdBank，不要把理财持仓总额放进投入账户。',
    '理财截图映射规则：美/美国/美股 -> investHoldings.us；欧/欧洲 -> eu；亚/亚洲 -> asia；A/A股 -> a；债/长债/国开债 -> longBond；美债 -> usBond；黄金 -> gold。分组标题右侧金额优先于逐项求和。',
    '美股明细：只提取“美/美国/美股”分组里的单项，返回 name、symbol、amount、currency；看不清代码时 symbol 返回 null。',
    '如果某字段截图里没有明确出现，返回 null。返回必须严格符合 schema。',
  ].join('\n');
}

function extractOutputText(payload: unknown): string {
  const data = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof data.output_text === 'string') return data.output_text;
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: '缺少 OPENAI_API_KEY' });

  try {
    const { imageDataUrl, mode = 'auto' } = parseBody(req);
    if (!imageDataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'invalid image' });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: promptFor(mode) },
            { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'finance_screenshot_parse',
            strict: true,
            schema: parseSchema,
          },
        },
        max_output_tokens: 2500,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI HTTP ${response.status}`;
      return res.status(response.status).json({ error: message });
    }

    const text = extractOutputText(payload);
    if (!text) return res.status(502).json({ error: '识别结果为空' });
    return res.status(200).json(JSON.parse(text));
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
