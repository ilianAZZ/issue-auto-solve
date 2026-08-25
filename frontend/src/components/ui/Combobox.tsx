import { useEffect, useRef, useState } from 'react';

/** A text input that filters a fixed list of options as you type, picked from a dropdown. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  loading,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  loading?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const query = value.trim().toLowerCase();
  const filtered = query ? options.filter((option) => option.toLowerCase().includes(query)) : options;
  const shown = filtered.slice(0, 50);

  function pick(option: string) {
    onChange(option);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? 'Loading repositories…' : placeholder}
        className="w-full rounded-lg border border-border bg-panel-2 p-2 text-[13px] text-text"
      />
      {open && shown.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-panel p-1 shadow-[0_4px_16px_rgba(16,16,24,.12)]">
          {shown.map((option) => (
            <li key={option}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-text hover:bg-panel-2"
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
