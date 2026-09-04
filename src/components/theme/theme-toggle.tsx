'use client';

import { useEffect, useState } from 'react';

type Preference = 'light' | 'dark' | 'system';

const OPTIONS: { value: Preference; label: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Claro',
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3M12.9 12.9l-1.3-1.3M4.4 4.4L3.1 3.1"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Sistema',
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
        <rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Oscuro',
    icon: (
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
        <path
          d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

function resolve(preference: Preference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Tres estados explícitos en vez de un interruptor binario: "sistema" es una
 * elección real y muchas personas la quieren de vuelta después de probar.
 * Se implementa como un grupo de radios para que el lector de pantalla anuncie
 * cuál está activo.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<Preference>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = document.documentElement.dataset.themePreference as Preference | undefined;
    setPreference(stored ?? 'system');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      document.documentElement.dataset.theme = resolve(preference);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference, mounted]);

  function choose(next: Preference): void {
    setPreference(next);
    document.documentElement.dataset.themePreference = next;
    try {
      if (next === 'system') localStorage.removeItem('uinexus-theme');
      else localStorage.setItem('uinexus-theme', next);
    } catch {
      /* Modo privado sin almacenamiento: el tema dura la sesión. */
    }
  }

  return (
    <fieldset className="inline-flex items-center rounded-sm border border-line p-[2px]">
      <legend className="sr-only">Tema de la interfaz</legend>
      {OPTIONS.map((option) => {
        const active = mounted && preference === option.value;
        return (
          <label
            key={option.value}
            className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-xs transition-colors ${
              active ? 'bg-accent-soft text-accent' : 'text-subtle hover:text-fg'
            }`}
            title={option.label}
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={active}
              onChange={() => choose(option.value)}
              className="sr-only"
            />
            {option.icon}
            <span className="sr-only">{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
