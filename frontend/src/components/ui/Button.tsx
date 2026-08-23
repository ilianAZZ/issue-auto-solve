import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

const base =
  'inline-flex items-center gap-1.5 rounded-lg border text-[12.5px] px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const variants = {
  default: 'border-border bg-panel-2 text-text hover:border-accent/40 hover:text-accent',
  primary: 'border-accent bg-accent text-white font-medium hover:brightness-110',
  ghost: 'border-transparent bg-transparent text-muted px-1.5 py-0.5 text-[15px] hover:text-text',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  children: ReactNode;
}

export function Button({ variant = 'default', className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: keyof typeof variants;
  children: ReactNode;
}

export function LinkButton({ variant = 'default', className = '', children, ...props }: LinkButtonProps) {
  return (
    <a className={`${base} no-underline ${variants[variant]} ${className}`} {...props}>
      {children}
    </a>
  );
}
