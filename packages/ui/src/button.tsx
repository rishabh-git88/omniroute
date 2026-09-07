import type { ButtonHTMLAttributes } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded-full bg-zinc-50 px-5 py-2.5 font-medium text-zinc-950 transition hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      type={type}
      {...props}
    />
  );
}
