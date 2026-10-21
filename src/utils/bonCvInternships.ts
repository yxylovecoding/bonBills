import type { AppConfig, InternshipPeriod, InternshipProfile } from '../models/types';
import type { BonCvInternship } from './bonCv';
import { BEIJING, DEFAULT_INTERNSHIP_RULES, migratedProfiles, validDate } from './internship';

function companyKey(name: string) {
  const key = name.trim().toLowerCase().replace(/\s+/g, '').replace(/模式$/, '');
  return ['字节', '字节跳动', 'bytedance'].includes(key) ? 'bytedance' : key;
}

// CV dates may be month-only or ongoing. Never infer paid days from that precision.
export function bonCvExactDate(raw: string): string {
  const match = raw.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!match) return '';
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return validDate(date) ? date : '';
}

export function importedBonCvPeriod(entry: BonCvInternship, config: Partial<AppConfig>) {
  return config.internshipPeriods?.find(p => p.bonCvSource?.entryId === entry.id);
}

export function prepareBonCvInternship(entry: BonCvInternship, config: Partial<AppConfig>, uid = () => crypto.randomUUID()): {
  period: InternshipPeriod; newProfile?: InternshipProfile;
} {
  const imported = importedBonCvPeriod(entry, config);
  if (imported) return { period: structuredClone(imported) };
  const key = companyKey(entry.company);
  const matching = key ? migratedProfiles(config).filter(p => companyKey(p.name) === key) : [];
  // Multiple matching templates require the user's explicit choice.
  const profile: InternshipProfile = matching.length === 1 ? matching[0] : {
    id: uid(), name: entry.company.trim(), revision: 1, rules: { ...DEFAULT_INTERNSHIP_RULES },
  };
  return {
    newProfile: matching.length === 1 ? undefined : profile,
    period: {
      id: uid(), profileId: profile.id, profileName: profile.name, revision: profile.revision,
      rules: structuredClone(profile.rules), startDate: bonCvExactDate(entry.startDate), endDate: bonCvExactDate(entry.endDate),
      city: null, schoolCity: structuredClone(config.schoolCity ?? BEIJING),
      bonCvSource: { entryId: entry.id, company: entry.company, startDate: entry.startDate, endDate: entry.endDate },
    },
  };
}
