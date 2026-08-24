import { useId, useState } from 'react';
import { Button } from './Button';

export function ChipList({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  function add() {
    const item = draft.trim();
    if (!item || value.includes(item)) return;
    onChange([...value, item]);
    setDraft('');
  }

  function remove(item: string) {
    onChange(value.filter((v) => v !== item));
  }

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-1.5 flex list-none flex-wrap gap-1.5 p-0">
          {value.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1 rounded-full border border-border bg-panel-2 py-0.5 pl-2.5 pr-1 text-[12px]"
            >
              {item}
              <button
                type="button"
                onClick={() => remove(item)}
                aria-label={`Remove ${item}`}
                className="grid h-4 w-4 place-items-center rounded-full text-muted hover:bg-border hover:text-text"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          list={suggestions?.length ? listId : undefined}
          className="min-w-[140px] flex-1 rounded-lg border border-border bg-panel-2 p-1.5 text-[12.5px] text-text"
        />
        {suggestions?.length ? (
          <datalist id={listId}>
            {suggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        ) : null}
        <Button onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
