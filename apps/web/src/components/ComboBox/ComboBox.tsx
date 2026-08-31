import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./ComboBox.css";

export interface ComboBoxOption {
  value: string;
  /** Shown as the option's primary text, and as the field's value once picked. */
  label: string;
  /** Small muted detail under the label — keep this to the one or two facts
   *  that actually help someone choose (e.g. a rate), not a full profile. */
  meta?: string;
  /** Extra text folded into search only — never rendered. Lets someone find
   *  an option by a word that isn't part of its visible label. */
  keywords?: string;
}

interface ComboBoxProps {
  id?: string;
  value: string;
  options: ComboBoxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

/** Every space-separated word in the query must appear somewhere in the
 *  option's searchable text, in any order — so "short black and white"
 *  matches a label like "Short Standard Printing | B&W (Black and White)"
 *  even though the words come from two different fields. */
function matchesQuery(query: string, option: ComboBoxOption): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = `${option.label} ${option.keywords ?? ""}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** A searchable dropdown: types like a text input, filters like search, but
 *  commits a `value` like a <select>. Drop-in replacement for a <select>
 *  wherever the option list is long or its labels are made of several parts
 *  someone might search by separately. */
export function ComboBox({ id, value, options, onChange, placeholder, emptyMessage = "No matches", disabled, ariaInvalid }: ComboBoxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = open ? options.filter((option) => matchesQuery(query, option)) : options;

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
  }

  function pick(option: ComboBoxOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[highlighted];
      if (option) pick(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  const activeOption = open ? filtered[highlighted] : undefined;

  return (
    <div className={`combobox${disabled ? " combobox--disabled" : ""}`} ref={rootRef}>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-invalid={ariaInvalid || undefined}
        aria-activedescendant={activeOption ? `${listboxId}-${activeOption.value}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : selected?.label ?? ""}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        <ul className="combobox__list" role="listbox" id={listboxId}>
          {filtered.length === 0 ? (
            <li className="combobox__empty">{emptyMessage}</li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-${option.value}`}
                role="option"
                aria-selected={option.value === value}
                className={`combobox__option${index === highlighted ? " is-highlighted" : ""}${option.value === value ? " is-selected" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(option)}
              >
                <span className="combobox__option-label">{option.label}</span>
                {option.meta ? <span className="combobox__option-meta">{option.meta}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
