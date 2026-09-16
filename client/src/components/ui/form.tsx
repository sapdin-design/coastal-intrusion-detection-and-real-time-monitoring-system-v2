import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import { cn } from '@/lib/format';

/* ──────────────────────────── Field wrapper ──────────────────────────── */

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <label className="field-label">
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="field-error">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── Inputs ──────────────────────────────── */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn('field-input', invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/25', className)}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...rest }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'field-input resize-y',
      invalid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/25',
      className,
    )}
    {...rest}
  />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, children, ...rest }, ref) => (
  <select
    ref={ref}
    className={cn(
      'field-input cursor-pointer appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9',
      invalid && 'border-rose-400',
      className,
    )}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E\")",
    }}
    {...rest}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="field-input pl-8"
      />
    </div>
  );
}

/* ─────────────────────────────── Toggle ──────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
          )}
        />
      </button>
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-[13px] font-medium text-slate-800">{label}</span> : null}
          {description ? <span className="block text-xs text-slate-500">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/* ─────────────────────────── Segmented control ───────────────────────── */

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              active ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
