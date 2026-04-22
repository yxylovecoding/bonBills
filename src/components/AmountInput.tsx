import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { tryEvalFormula } from '../utils/formula';

export interface AmountInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: string;
  onChange: (value: string) => void;
}

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
        onChange={(e) => onChange(e.target.value)}
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
