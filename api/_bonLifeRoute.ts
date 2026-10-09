import { withAccountScope } from './_accountRoute.js';
import { hydrateMakeupEntries } from '../src/utils/lifeMakeup.js';
import { DEFAULT_SKIN_SETTINGS, currentSkinSettings, parseSkinSettings, type SkinSettings } from '../src/utils/lifeSkin.js';
import { randomUUID } from 'node:crypto';
import { kv } from './_accountKv.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authOk, sameOrigin } from './_auth.js';
import { encryptOutlookConnection, validateOutlookUrl } from './_outlookCalendar.js';
import { DEFAULT_OUTLOOK_RULES } from '../src/utils/outlookCalendar.js';
import { DEFAULT_CYCLE, lifeYear, parseCycleSettings, parseLifeEdit, type CycleSettings, type LifeEntries, type LifeEntry } from '../src/utils/bonLife.js';
import { LIFE_CONNECTION_KEY, SAVE_LIFE_ENTRY, entriesKey, periodsKey, readPeriodCalendar, syncLifePeriods,
  LIFE_SETTINGS_KEY, LIFE_TRAINING_ENTRIES_KEY, LIFE_SYMPTOM_ENTRIES_KEY, readPeriodDays, type LifeConnection, type PeriodSnapshot } from './_bonLife.js';
import { doneMonth, readDoneMonth, syncDoneMonth } from './_lifeDone.js';
import { readTrainingSource, syncTrainingSource } from './_lifeTraining.js';
import { swimmingSyncWarning } from './_lifeSwimming.js';
import { parseTrainingSettings, type TrainingSettings } from '../src/utils/lifeTraining.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源无效' });
  try {
    if (!await authOk(req)) return res.status(401).json({ error: '请先登录' });
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: '请求方式无效' });
    if (req.method === 'DELETE') {
      await kv.del(LIFE_CONNECTION_KEY);
      return res.status(200).json({ connected: false });
    }
    let body: Record<string, unknown> = {};
    let year: number;
    try {
      if (req.method !== 'GET') body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      year = lifeYear(req.method === 'GET' ? req.query.year : body?.year ?? String(body?.date).slice(0, 4));
    } catch { return res.status(400).json({ error: '请求内容或年份无效' }); }
    if (req.method === 'GET') {
      if (req.query.view === 'training') return res.status(200).json(await readTrainingSource(year));
      if (req.query.view === 'done') {
        let month: string;
        try { month = doneMonth(year, req.query.month); } catch { return res.status(400).json({ error: '月份无效' }); }
        return res.status(200).json(await readDoneMonth(month));
      }
      const [entries, periods, connection, days, settings, previousEntries, symptoms] = await Promise.all([
        kv.hgetall<LifeEntries>(entriesKey(year)), kv.get<PeriodSnapshot>(periodsKey(year)), kv.get<LifeConnection>(LIFE_CONNECTION_KEY),
        readPeriodDays(year), kv.hgetall<{ cycle: CycleSettings; skin?: SkinSettings }>(LIFE_SETTINGS_KEY),
        year > 1900 ? kv.hgetall<LifeEntries>(entriesKey(year - 1)) : null,
        kv.hgetall<LifeEntries>(LIFE_SYMPTOM_ENTRIES_KEY),
      ]);
      return res.status(200).json({ year, entries: hydrateMakeupEntries(entries ?? {}), periodDays: days, cycle: settings?.cycle ?? DEFAULT_CYCLE,
        skinSettings: currentSkinSettings(settings?.skin ?? DEFAULT_SKIN_SETTINGS),
        symptomHistory: Object.fromEntries(Object.entries({ ...symptoms, ...previousEntries, ...entries })
          .filter(([key]) => key.startsWith('eyes:') || key.startsWith('discomfort:'))),
        skinHistory: Object.fromEntries(Object.entries(previousEntries ?? {}).filter(([key]) => key.startsWith(`skin:${year - 1}-`))), syncedAt: periods?.syncedAt ?? null, connected: Boolean(connection) });
    }
    if (req.method === 'PUT') {
      let url: string;
      try {
        if (typeof body.url !== 'string' || body.url.length > 4096) throw new Error();
        url = validateOutlookUrl(body.url);
      } catch { return res.status(400).json({ error: '请输入 Outlook 发布的 ICS 订阅链接' }); }
      const connection: LifeConnection = { id: randomUUID(), encrypted: encryptOutlookConnection({ playUrl: url, classUrl: '',
        policy: 'manual', rules: DEFAULT_OUTLOOK_RULES }, (process.env.SYNC_SECRET || '').trim()) };
      // Verify the subscription before replacing a working connection.
      await readPeriodCalendar(connection, year);
      await kv.set(LIFE_CONNECTION_KEY, connection);
      return res.status(200).json({ connected: true });
    }
    if (body.action === 'sync-periods') {
      const connection = await kv.get<LifeConnection>(LIFE_CONNECTION_KEY);
      if (!connection) return res.status(200).json({ connected: false, swimmingError: await swimmingSyncWarning() });
      const result = await syncLifePeriods(connection, year);
      return res.status(200).json({ connected: true, ...result, periodDays: await readPeriodDays(year), swimmingError: await swimmingSyncWarning() });
    }
    if (body.action === 'sync-done') {
      let month: string;
      try { month = doneMonth(year, body.month); } catch { return res.status(400).json({ error: '月份无效' }); }
      return res.status(200).json(await syncDoneMonth(month));
    }
    if (body.action === 'sync-training') return res.status(200).json(await syncTrainingSource(year));
    if (body.action === 'save-training-settings') {
      let settings: TrainingSettings;
      try {
        settings = parseTrainingSettings(body.settings);
        if (typeof body.mutationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.mutationId)) throw new Error();
      } catch { return res.status(400).json({ error: '训练项目设置无效' }); }
      const next = { ...settings, revision: body.mutationId };
      const [ok, raw] = await kv.eval<string[], [number, string | TrainingSettings]>(SAVE_LIFE_ENTRY, [LIFE_SETTINGS_KEY],
        ['trainingProjects', settings.revision, body.mutationId as string, JSON.stringify(next), 'training-settings']);
      if (!ok) return res.status(409).json({ error: '训练项目已在其他页面更新，请重新打开后修改' });
      return res.status(200).json({ settings: typeof raw === 'string' ? JSON.parse(raw) : raw });
    }
    if (body.action === 'save-cycle') {
      let cycle: CycleSettings;
      try {
        cycle = parseCycleSettings(body.cycle);
        if (typeof body.mutationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.mutationId)) throw new Error();
      } catch { return res.status(400).json({ error: '经期设置无效' }); }
      const previous = (await kv.hgetall<{ cycle: CycleSettings }>(LIFE_SETTINGS_KEY))?.cycle;
      const periodStarts = [...new Set([...(previous?.periodStarts ?? []), previous?.lastPeriodStart, cycle.lastPeriodStart].filter((date): date is string => Boolean(date)))].sort();
      const next = { ...cycle, periodStarts, revision: body.mutationId };
      const [ok, raw] = await kv.eval<string[], [number, string | CycleSettings]>(SAVE_LIFE_ENTRY, [LIFE_SETTINGS_KEY],
        ['cycle', cycle.revision, body.mutationId as string, JSON.stringify(next), 'cycle']);
      if (!ok) return res.status(409).json({ error: '经期设置已在其他页面更新，请重新打开设置' });
      return res.status(200).json({ cycle: typeof raw === 'string' ? JSON.parse(raw) : raw, swimmingError: await swimmingSyncWarning() });
    }
    if (body.action === 'save-skin-settings') {
      let settings: SkinSettings;
      try {
        settings = currentSkinSettings(parseSkinSettings(body.settings));
        if (typeof body.mutationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.mutationId)) throw new Error();
      } catch { return res.status(400).json({ error: '皮肤方案或用品信息无效' }); }
      const next = { ...settings, revision: body.mutationId };
      const [ok, raw] = await kv.eval<string[], [number, string | SkinSettings]>(SAVE_LIFE_ENTRY, [LIFE_SETTINGS_KEY],
        ['skin', settings.revision, body.mutationId as string, JSON.stringify(next), 'skin-settings']);
      if (!ok) return res.status(409).json({ error: '皮肤设置已在其他页面更新，请重新打开后修改' });
      return res.status(200).json({ settings: typeof raw === 'string' ? JSON.parse(raw) : raw });
    }
    if (body.action !== 'save') return res.status(400).json({ error: '操作无效' });
    let edit;
    try { edit = parseLifeEdit(body); }
    catch { return res.status(400).json({ error: '记录内容无效' }); }
    const entry: LifeEntry = { text: edit.text, revision: edit.mutationId,
      ...(edit.makeup ? { makeup: edit.makeup } : {}),
      ...(edit.skin ? { skin: edit.skin } : {}), ...(edit.eyes ? { eyes: edit.eyes } : {}), ...(edit.discomfort ? { discomfort: edit.discomfort } : {}),
      ...(edit.body ? { body: edit.body } : {}), ...(edit.training ? { training: edit.training } : {}) };
    const [ok, raw] = await kv.eval<string[], [number, string | LifeEntry]>(SAVE_LIFE_ENTRY,
      [entriesKey(edit.year), ...(edit.kind === 'training' ? [LIFE_TRAINING_ENTRIES_KEY]
        : edit.kind === 'eyes' || edit.kind === 'discomfort' ? [LIFE_SYMPTOM_ENTRIES_KEY] : [])],
      [`${edit.kind}:${edit.date}`, edit.revision, edit.mutationId, JSON.stringify(entry), '',
        edit.kind === 'skin' || edit.kind === 'eyes' ? `makeup:${edit.date}` : '']);
    const stored = typeof raw === 'string' ? (raw ? JSON.parse(raw) : { text: '', revision: '' }) : raw;
    if (!ok) return res.status(409).json({ error: '这一天的记录已在其他页面更新', current: stored });
    return res.status(200).json({ entry: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === '日历连接或内容已更新，请重新同步') return res.status(409).json({ error: message });
    if (message.startsWith('Outlook 日历读取失败')) return res.status(502).json({ error: message });
    if (message.startsWith('TickTick 完成记录同步失败')) return res.status(502).json({ error: message });
    if (message.startsWith('TickTick 训练计划同步失败')) return res.status(502).json({ error: message });
    if (message.startsWith('TickTick 游泳') || message.startsWith('TickTick 正在同步')) return res.status(502).json({ error: message });
    return res.status(503).json({ error: '暂时无法保存或读取，请重试' });
  }
}

export default withAccountScope(handler);
