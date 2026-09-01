import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { tryEvalFormula } from '../utils/formula';
import {
  normalizeDecimalPunctuation,
  normalizeSitePrecisionForDisplay,
  SITE_DECIMAL_PLACES,
} from '../utils/numberInput';

export interface AmountInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  decimalPlaces?: number;
}

const sanitizeAmount = (raw: string, decimalPlaces: number): string | null => {
  const normalized = normalizeDecimalPunctuation(raw).replace(/（/g, '(').replace(/）/g, ')');
  if (normalized === '') return '';
  if (!/^[\d+\-*/(). ]*$/.test(normalized)) return null;
  const tokens = normalized.split(/[+\-*/() ]/);
  if (tokens.some((t) => {
    if ((t.match(/\./g) || []).length > 1) return true;
    return (t.split('.')[1]?.length ?? 0) > decimalPlaces;
  })) return null;
  return normalized;
};

const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onChange, decimalPlaces = SITE_DECIMAL_PLACES, onBlur, onKeyDown, onFocus, inputMode, ...rest }, ref) => {
    const applyFormula = (raw: string) => {
      const evaluated = tryEvalFormula(raw);
      if (evaluated !== null && evaluated !== raw) onChange(evaluated);
    };
    return (
      <input
        ref={ref}
        type="text"
        inputMode={inputMode ?? 'decimal'}
        value={normalizeSitePrecisionForDisplay(value, decimalPlaces)}
        onChange={(e) => {
          const next = sanitizeAmount(e.target.value, decimalPlaces);
          if (next === null) return;
          onChange(next);
        }}
        onFocus={(e) => {
          e.target.select();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          applyFormula(e.currentTarget.value);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') applyFormula(e.currentTarget.value);
          onKeyDown?.(e);
        }}
        {...rest}
      />
    );
  },
);
AmountInput.displayName = 'AmountInput';

export default AmountInput;
