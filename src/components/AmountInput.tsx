import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { tryEvalFormula } from '../utils/formula';

export interface AmountInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (value: string) => void;
}

const sanitizeAmount = (raw: string): string | null => {
  if (raw === '') return '';
  if (!/^[\d+\-*/(). ]*$/.test(raw)) return null;
  const tokens = raw.split(/[+\-*/() ]/);
  if (tokens.some((t) => (t.match(/\./g) || []).length > 1)) return null;
  return raw;
};

const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onChange, onBlur, onKeyDown, onFocus, inputMode, ...rest }, ref) => {
    const applyFormula = (raw: string) => {
      const evaluated = tryEvalFormula(raw);
      if (evaluated !== null && evaluated !== raw) onChange(evaluated);
    };
    return (
      <input
        ref={ref}
        type="text"
        inputMode={inputMode ?? 'decimal'}
        value={value}
        onChange={(e) => {
          const next = sanitizeAmount(e.target.value);
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
