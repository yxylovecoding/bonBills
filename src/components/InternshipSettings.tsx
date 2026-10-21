import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppConfig, InternshipPeriod, InternshipProfile, InternshipRules, SceneCity } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { BEIJING, GUANGZHOU, DEFAULT_INTERNSHIP_RULES, internshipStart, migratedProfiles, periodOverlap, periodReady, rulesError, shiftDay } from '../utils/internship';
import { TAX_RULE_PRESETS, calculateIncomeTax } from '../utils/tax';
import SceneCityFields from './SceneCityFields';
import { fetchBonCvInternships, type BonCvInternship } from '../utils/bonCv';
import { importedBonCvPeriod, prepareBonCvInternship } from '../utils/bonCvInternships';

const input: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #dadce0', borderRadius: 7, fontSize: 12, background: '#fff' };
const button: CSSProperties = { border: 'none', borderRadius: 7, background: '#f1f3f4', color: '#1a73e8', padding: '6px 10px', fontSize: 12, cursor: 'pointer' };
const row: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 };
const uid = () => crypto.randomUUID();
const cityPresets = [BEIJING, GUANGZHOU];
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#5f6368' }}>{label}{children}</label>;
}
export function CityPicker({ city, onChange, label = '居住城市' }: { city?: SceneCity | null; onChange: (city: SceneCity | null) => void; label?: string }) {
  return <div style={{ marginTop: 8 }}>
    <SceneCityFields value={{ schoolCity: city }} onChange={value => onChange(value.schoolCity ?? null)} schoolLabel={label} onlySchool presets={cityPresets} />
  </div>;
}
function RuleFields({ value: r, onChange }: { value: InternshipRules; onChange: (r: InternshipRules) => void }) {
  const set = <K extends keyof InternshipRules>(key: K, value: InternshipRules[K]) => onChange({ ...r, [key]: value });
  const select = <K extends keyof InternshipRules>(key: K, label: string, choices: [string, string][]) => <Field label={label}><select aria-label={label} style={input} value={String(r[key])} onChange={e => set(key, e.target.value as InternshipRules[K])}>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>;
  const number = (key: 'cutoffDay' | 'cutoffOffset' | 'payDay' | 'housingAmount', label: string, min = 0, max?: number) => <Field label={label}><input aria-label={label} style={input} type="number" min={min} max={max} value={r[key]} onChange={e => set(key, Number(e.target.value))} /></Field>;
  return <>
    <div style={row}>
      {select('salaryKind', '工资方式', [['daily', '日薪'], ['monthly', '月薪']])}
      <Field label="工资金额"><input aria-label="工资金额" style={input} type="number" min="0" value={r.salary ?? ''} onChange={e => set('salary', e.target.value === '' ? null : Number(e.target.value))} /></Field>
      {select('workweek', '工作日', [['statutory', '法定工作日（含调休）'], ['weekdays', '周一至周五']])}
      {r.salaryKind === 'monthly' && <Field label="月薪折算天数"><input aria-label="月薪折算天数" style={input} type="number" min="0.01" step="0.01" placeholder="周期应工作日数" value={r.monthlyDivisor ?? ''} onChange={e => set('monthlyDivisor', e.target.value ? Number(e.target.value) : undefined)} /></Field>}
      {select('cycle', '计薪周期', [['calendar', '自然月'], ['cutoff', '固定截薪日'], ['beforePay', '发薪日前截止']])}
      {r.cycle === 'cutoff' && number('cutoffDay', '截薪日', 1, 31)}
      {r.cycle === 'beforePay' && number('cutoffOffset', '发薪前天数', 0, 28)}
      <Field label="发薪月份"><select aria-label="发薪月份" style={input} value={r.payMonthOffset} onChange={e => set('payMonthOffset', Number(e.target.value) as 0 | 1)}><option value="0">当月</option><option value="1">次月</option></select></Field>
      {select('payKind', '发薪日期', [['fixed', '固定日期'], ['monthEnd', '月底'], ['lastWorkingDay', '最后工作日']])}
      {r.payKind === 'fixed' && number('payDay', '发薪日', 1, 31)}
      {select('payAdjustment', '遇休息日', [['none', '不调整'], ['previous', '提前'], ['next', '顺延']])}
      {select('housingKind', '房补方式', [['none', '无房补'], ['monthly', '月补'], ['residence', '居住自然日补'], ['attendance', '出勤日补']])}
      {r.housingKind !== 'none' && number('housingAmount', r.housingKind === 'monthly' ? '每月房补' : '每日房补')}
    </div>
    {r.housingKind !== 'none' && <div style={{ ...row, fontSize: 12 }}>
      {r.housingKind === 'monthly' && <label><input type="checkbox" checked={r.housingProrated} onChange={e => set('housingProrated', e.target.checked)} />不足期按自然日折算</label>}
      <label><input type="checkbox" checked={r.housingTaxable} onChange={e => set('housingTaxable', e.target.checked)} />房补合并扣税</label>
    </div>}
    <div style={{ marginTop: 8 }}><Field label="扣税规则"><select aria-label="扣税预设" style={input} value={TAX_RULE_PRESETS.some(p => p.text === r.taxRuleText) ? r.taxRuleText : r.taxRuleText ? 'custom' : ''} onChange={e => set('taxRuleText', e.target.value === 'custom' ? '税=' : e.target.value)}>
      <option value="">不扣税</option>{TAX_RULE_PRESETS.map(p => <option key={p.key} value={p.text}>{p.label}</option>)}<option value="custom">自定义</option></select>
      <input aria-label="扣税规则" style={input} value={r.taxRuleText ?? ''} onChange={e => set('taxRuleText', e.target.value)} /></Field></div>
  </>;
}
export function InternshipPeriods({ config, onChange }: { config: AppConfig; onChange: (changes: Partial<AppConfig>) => void }) {
  const profiles = migratedProfiles(config), periods = config.internshipPeriods ?? [];
  const [editing, setEditing] = useState<InternshipPeriod | null>(null), [error, setError] = useState('');
  const [switchDate, setSwitchDate] = useState(''), [switchProfile, setSwitchProfile] = useState('');
  const [bonCvEntries, setBonCvEntries] = useState<BonCvInternship[] | null>(null);
  const [importLoading, setImportLoading] = useState(false), [importError, setImportError] = useState('');
  const [newProfile, setNewProfile] = useState<InternshipProfile | null>(null);
  const importRequest = useRef<AbortController>();
  useEffect(() => () => importRequest.current?.abort(), []);
  const editorProfiles = newProfile ? [...profiles, newProfile] : profiles;
  async function loadBonCv() {
    importRequest.current?.abort();
    const request = new AbortController();
    importRequest.current = request;
    setImportLoading(true); setImportError('');
    try {
      const entries = await fetchBonCvInternships(request.signal);
      if (!request.signal.aborted) setBonCvEntries(entries);
    } catch (error) {
      if (!request.signal.aborted) setImportError(error instanceof Error ? error.message : 'BonCV 暂时无法连接，请重试');
    } finally {
      if (!request.signal.aborted) setImportLoading(false);
    }
  }
  function save(next: InternshipPeriod[]) {
    const starts = next.filter(periodReady).map(p => p.startDate);
    const enabled = [internshipStart(config), ...starts].filter((d): d is string => Boolean(d)).sort()[0];
    const nextProfiles = newProfile && next.some(p => p.profileId === newProfile.id) ? [...profiles, newProfile] : profiles;
    onChange({ internshipPeriods: next, internshipProfiles: nextProfiles, internshipEnabledFrom: enabled,
      internshipLegacyCity: config.internshipLegacyCity ?? config.schoolCity ?? BEIJING });
    setEditing(null); setNewProfile(null); setError('');
  }
  function begin(p?: InternshipPeriod) {
    const profile = profiles[0];
    setEditing(p ?? { id: uid(), profileId: profile?.id ?? '', profileName: profile?.name ?? '', revision: profile?.revision ?? 1,
      rules: structuredClone(profile?.rules ?? DEFAULT_INTERNSHIP_RULES), startDate: '', endDate: '', city: null, schoolCity: config.schoolCity ?? BEIJING });
    setNewProfile(null); setError(''); setSwitchDate(''); setSwitchProfile('');
  }
  function applySwitch() {
    if (!editing) return;
    const source = periods.find(p => p.id === editing.id) ?? editing;
    const profile = profiles.find(p => p.id === switchProfile);
    if (!profile || !periodReady({ ...editing, startDate: switchDate, rules: profile.rules }) || switchDate < source.startDate || switchDate > source.endDate) { setError('请选择实习段内的新生效日期和完整公司模式'); return; }
    const next: InternshipPeriod = { ...editing, id: uid(), startDate: switchDate, endDate: source.endDate, profileId: profile.id, profileName: profile.name, revision: profile.revision, rules: structuredClone(profile.rules) };
    save([...periods.filter(p => p.id !== editing.id), ...(switchDate > source.startDate ? [{ ...source, endDate: shiftDay(switchDate, -1) }] : []), next].sort((a, b) => a.startDate.localeCompare(b.startDate)));
  }
  return <div style={{ marginTop: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 13, fontWeight: 700 }}>实习日期<div style={{ display: 'flex', gap: 6 }}><button type="button" disabled={importLoading || Boolean(editing)} style={button} onClick={() => void loadBonCv()}>{importLoading ? '读取中' : '从 BonCV 导入'}</button><button type="button" style={button} onClick={() => begin()}>＋实习段</button></div></div>
    {importError && <div role="alert" style={{ color: '#c5221f', fontSize: 12, marginTop: 6 }}>{importError}</div>}
    {bonCvEntries && !editing && <div style={{ marginTop: 8, padding: 8, border: '1px solid #dadce0', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}><span>BonCV 经历</span><button type="button" style={button} onClick={() => setBonCvEntries(null)}>收起</button></div>
      {bonCvEntries.length === 0 && <div role="status" style={{ fontSize: 12, color: '#5f6368', marginTop: 6 }}>暂无可导入经历</div>}
      {bonCvEntries.map(entry => {
        const imported = importedBonCvPeriod(entry, config);
        return <button type="button" key={entry.id} disabled={Boolean(imported)} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', marginTop: 6, opacity: imported ? 0.6 : 1 }} onClick={() => {
          const result = prepareBonCvInternship(entry, config);
          begin(result.period); setNewProfile(result.newProfile ?? null);
        }}>{entry.company || '公司未填写'}{imported ? ' · 已导入' : ''}<br /><span style={{ color: '#5f6368', fontSize: 11 }}>{entry.startDate || '开始日期未填写'} — {entry.endDate || '结束日期未填写'}</span></button>;
      })}
    </div>}
    {periods.map(p => <button type="button" key={p.id} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', marginTop: 6 }} onClick={() => begin(p)}>{p.city?.name ?? '城市未设置'} · {p.profileName || '公司未设置'}<br /><span style={{ fontSize: 11, color: '#5f6368' }}>{p.startDate || '开始日期'} — {p.endDate || '结束日期'}{!periodReady(p) ? ' · 草稿' : ''}</span></button>)}
    {editing && <div style={{ marginTop: 8, border: '1px solid #dadce0', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 6 }}>{editing.profileName} · v{editing.revision}</div>
      {editing.bonCvSource && <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 6 }}>BonCV · {editing.bonCvSource.startDate || '开始日期未填写'} — {editing.bonCvSource.endDate || '结束日期未填写'}</div>}
      <Field label="公司模式"><select aria-label="实习公司模式" disabled={periods.some(p => p.id === editing.id && periodReady(p))} style={input} value={`${editing.profileId}:${editing.revision}`} onChange={e => { const p = editorProfiles.find(p => `${p.id}:${p.revision}` === e.target.value); if (p) setEditing({ ...editing, profileId: p.id, profileName: p.name, revision: p.revision, rules: structuredClone(p.rules) }); }}>
        <option value="">选择公司</option>{editing.profileId && !editorProfiles.some(p => p.id === editing.profileId && p.revision === editing.revision) && <option value={`${editing.profileId}:${editing.revision}`}>{editing.profileName} · v{editing.revision}</option>}{editorProfiles.map(p => <option key={p.id} value={`${p.id}:${p.revision}`}>{p.name || '新公司'} · v{p.revision}</option>)}
      </select></Field>
      {newProfile && editing.profileId === newProfile.id && <div style={{ marginTop: 8 }}>
        <Field label="公司名称"><input aria-label="导入公司名称" style={input} value={newProfile.name} onChange={e => { setNewProfile({ ...newProfile, name: e.target.value }); setEditing({ ...editing, profileName: e.target.value }); }} /></Field>
        <RuleFields value={editing.rules} onChange={rules => { setNewProfile({ ...newProfile, rules }); setEditing({ ...editing, rules }); }} />
      </div>}
      <div style={row}>{(['startDate', 'endDate'] as const).map((key, i) => <Field key={key} label={i ? '结束日期' : '开始日期'}><input aria-label={i ? '实习结束日期' : '实习开始日期'} type="date" style={input} value={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.value })} /></Field>)}</div>
      <CityPicker city={editing.city} onChange={city => setEditing({ ...editing, city })} />
      {periods.some(p => p.id === editing.id && periodReady(p)) && <details style={{ fontSize: 12, marginBottom: 8 }}><summary>从指定日期切换公司</summary><div style={row}><input aria-label="切换生效日期" type="date" style={input} value={switchDate} onChange={e => setSwitchDate(e.target.value)} /><select aria-label="切换到公司" style={input} value={switchProfile} onChange={e => setSwitchProfile(e.target.value)}><option value="">选择公司</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.revision}</option>)}</select></div><button type="button" style={{ ...button, marginTop: 8 }} onClick={applySwitch}>切换</button></details>}
      {error && <div role="alert" style={{ color: '#c5221f', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6 }}><button type="button" style={button} onClick={() => {
        if (editing.startDate && editing.endDate && editing.startDate > editing.endDate) { setError('结束日期不能早于开始日期'); return; }
        if (periodOverlap(editing, periods)) { setError('实习日期与已有实习段重叠'); return; }
        if (!editing.profileId) { setError('请先在收入管理添加公司模式'); return; }
        if (newProfile && editing.profileId === newProfile.id) {
          const taxError = calculateIncomeTax(10000, editing.rules.taxRuleText).ruleError;
          if (!newProfile.name.trim()) { setError('请填写公司名称'); return; }
          if ((editing.rules.salary !== null && rulesError(editing.rules)) || taxError) { setError(taxError ?? rulesError(editing.rules) ?? ''); return; }
        }
        save([...periods.filter(p => p.id !== editing.id), editing].sort((a, b) => a.startDate.localeCompare(b.startDate)));
      }}>{periodReady(editing) ? '保存实习段' : '保存草稿'}</button><button type="button" style={button} onClick={() => { setEditing(null); setNewProfile(null); }}>取消</button><button type="button" style={{ ...button, color: '#c5221f' }} onClick={() => save(periods.filter(p => p.id !== editing.id))}>删除</button></div>
    </div>}
  </div>;
}
export default function InternshipSettings() {
  const { config, setConfig } = useConfigStore();
  const profiles = migratedProfiles(config);
  const [draft, setDraft] = useState<InternshipProfile | null>(null), [error, setError] = useState('');
  return <div style={{ marginBottom: 12, borderBottom: '1px solid #e8eaed', paddingBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong style={{ fontSize: 13 }}>公司模式</strong><button style={button} type="button" onClick={() => { setDraft({ id: uid(), name: '', revision: 1, rules: { ...DEFAULT_INTERNSHIP_RULES } }); setError(''); }}>＋公司</button></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{profiles.map(p => <button key={p.id} type="button" style={button} onClick={() => { setDraft(structuredClone(p)); setError(''); }}>{p.name} · v{p.revision}{rulesError(p.rules) ? ' · 草稿' : ''}</button>)}</div>
    {draft && <div style={{ marginTop: 8 }}>
      <Field label="公司名称"><input aria-label="公司名称" style={input} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
      <RuleFields value={draft.rules} onChange={rules => setDraft({ ...draft, rules })} />
      {error && <p role="alert" style={{ fontSize: 12, color: '#c5221f' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button style={button} type="button" onClick={() => {
        const ruleError = rulesError(draft.rules), taxError = calculateIncomeTax(10000, draft.rules.taxRuleText).ruleError;
        if (!draft.name.trim() || (draft.rules.salary !== null && ruleError) || taxError) { setError(!draft.name.trim() ? '请填写公司名称' : taxError ?? ruleError ?? ''); return; }
        const old = profiles.find(p => p.id === draft.id);
        setConfig({ internshipProfiles: [...profiles.filter(p => p.id !== draft.id), { ...draft, name: draft.name.trim(), revision: old ? old.revision + 1 : 1 }], internshipLegacyCity: config.internshipLegacyCity ?? config.schoolCity ?? BEIJING });
        setDraft(null);
      }}>{draft.rules.salary === null ? '保存草稿' : '保存模式'}</button><button style={button} type="button" onClick={() => setDraft({ ...draft, id: uid(), name: `${draft.name} 副本`, revision: 1, legacyIncomeId: undefined })}>复制</button><button style={button} type="button" onClick={() => setDraft(null)}>取消</button></div>
    </div>}
    <InternshipPeriods config={config} onChange={setConfig} />
  </div>;
}
