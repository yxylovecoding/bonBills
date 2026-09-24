import type { FireExpenseScenario } from '../models/types';
import { encodeFireScenario, resolveFireScenario } from '../calculations/fireScenario';

export default function FireScenarioToggle({ scenario, onChange }: {
  scenario?: FireExpenseScenario;
  onChange: (scenario: FireExpenseScenario) => void;
}) {
  const { base, includesTravel } = resolveFireScenario(scenario);
  const label = base === 'home' ? '寄' : '居';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        onClick={() => onChange(encodeFireScenario(base === 'home' ? 'independent' : 'home', includesTravel))}
        aria-label={`FIRE 后生活场景：${label}`}
        title={`切换为${base === 'home' ? '居' : '寄'}`}
        style={{ border: '1px solid #e0e0e0', borderRadius: 999, backgroundColor: '#fff', color: '#202124', fontSize: 12, fontWeight: 700, padding: '5px 8px', cursor: 'pointer' }}
      >
        {label}
      </button>
      <span aria-hidden="true" style={{ color: '#5f6368', fontSize: 12 }}>＋</span>
      <button
        type="button"
        aria-label="FIRE 后计入旅行"
        aria-pressed={includesTravel}
        onClick={() => onChange(encodeFireScenario(base, !includesTravel))}
        style={{ border: `1px solid ${includesTravel ? '#d2e3fc' : '#e0e0e0'}`, borderRadius: 999, backgroundColor: includesTravel ? '#e8f0fe' : '#fff', color: includesTravel ? '#1a73e8' : '#5f6368', fontSize: 12, fontWeight: 700, padding: '5px 8px', cursor: 'pointer', transition: 'all 0.15s' }}
      >
        旅
      </button>
    </div>
  );
}
