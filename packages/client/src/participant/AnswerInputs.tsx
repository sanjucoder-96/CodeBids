/**
 * The generic answer surface (spec section 6).
 *
 * One component per question type, all producing the same `SubmissionValue`
 * union. Adding a question type to the pool means adding a case here and a case
 * in the shared evaluator - nothing else in the app changes.
 */

import { useCallback } from 'react';
import { motion } from 'motion/react';
import type { QuestionPublic, SubmissionValue } from '@code-market/shared';

interface Props {
  question: QuestionPublic;
  value: SubmissionValue | null;
  onChange: (value: SubmissionValue) => void;
  disabled?: boolean;
}

export function AnswerInput({ question, value, onChange, disabled }: Props) {
  switch (question.type) {
    case 'mcq':
      return <ChoiceInput question={question} value={value} onChange={onChange} disabled={disabled} multi={false} />;
    case 'multi':
      return <ChoiceInput question={question} value={value} onChange={onChange} disabled={disabled} multi />;
    case 'true_false':
      return <BooleanInput value={value} onChange={onChange} disabled={disabled} />;
    case 'numeric':
      return <NumericInput question={question} value={value} onChange={onChange} disabled={disabled} />;
    case 'ordering':
      return <OrderingInput question={question} value={value} onChange={onChange} disabled={disabled} />;
    case 'matching':
      return <MatchingInput question={question} value={value} onChange={onChange} disabled={disabled} />;
    case 'code':
      return <CodeInput question={question} value={value} onChange={onChange} disabled={disabled} />;
    default:
      return <TextInput question={question} value={value} onChange={onChange} disabled={disabled} />;
  }
}

/* ------------------------------------------------------------------ */

function ChoiceInput({
  question,
  value,
  onChange,
  disabled,
  multi,
}: Props & { multi: boolean }) {
  const selected = value?.kind === 'choice' ? value.optionIds : [];

  const toggle = (id: string) => {
    if (disabled) return;
    if (!multi) {
      onChange({ kind: 'choice', optionIds: [id] });
      return;
    }
    const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    onChange({ kind: 'choice', optionIds: next });
  };

  return (
    <div
      className="options"
      role={multi ? 'group' : 'radiogroup'}
      aria-label={multi ? 'Select all that apply' : 'Select one answer'}
    >
      {(question.question.options ?? []).map((option, index) => {
        const isSelected = selected.includes(option.id);
        return (
          <motion.button
            key={option.id}
            type="button"
            className="option"
            data-selected={isSelected}
            onClick={() => toggle(option.id)}
            disabled={disabled}
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isSelected}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.045, type: 'spring', stiffness: 380, damping: 30 }}
            whileTap={disabled ? undefined : { scale: 0.99 }}
          >
            <span className="option__marker" data-multi={multi} aria-hidden="true">
              {multi ? (isSelected ? '✓' : '') : String.fromCharCode(65 + index)}
            </span>
            <span className="option__text">{option.text}</span>
          </motion.button>
        );
      })}
      {multi ? (
        <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
          Select every option that applies. Partial answers are marked wrong.
        </p>
      ) : null}
    </div>
  );
}

function BooleanInput({
  value,
  onChange,
  disabled,
}: Pick<Props, 'value' | 'onChange' | 'disabled'>) {
  const current = value?.kind === 'boolean' ? value.value : null;
  return (
    <div className="options options--pair" role="radiogroup" aria-label="True or false">
      {[
        { label: 'TRUE', v: true },
        { label: 'FALSE', v: false },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          className="option option--big"
          data-selected={current === option.v}
          onClick={() => !disabled && onChange({ kind: 'boolean', value: option.v })}
          disabled={disabled}
          role="radio"
          aria-checked={current === option.v}
        >
          <span className="option__text">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function TextInput({ question, value, onChange, disabled }: Props) {
  const current = value?.kind === 'text' ? value.value : '';
  const multiline = question.type === 'output';

  return (
    <div className="field">
      <label className="label" htmlFor="answer-text">
        Your answer
      </label>
      {multiline ? (
        <textarea
          id="answer-text"
          className="textarea"
          value={current}
          onChange={(event) => onChange({ kind: 'text', value: event.target.value })}
          placeholder={question.question.placeholder ?? 'Type the exact output'}
          disabled={disabled}
          spellCheck={false}
          autoFocus
          rows={4}
        />
      ) : (
        <input
          id="answer-text"
          className="input"
          value={current}
          onChange={(event) => onChange({ kind: 'text', value: event.target.value })}
          placeholder={question.question.placeholder ?? 'Your answer'}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />
      )}
      <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
        Extra spaces and letter case are ignored.
      </p>
    </div>
  );
}

function NumericInput({ question, value, onChange, disabled }: Props) {
  const current = value?.kind === 'number' && Number.isFinite(value.value) ? String(value.value) : '';
  return (
    <div className="field">
      <label className="label" htmlFor="answer-number">
        Your answer{question.question.unit ? ` (${question.question.unit})` : ''}
      </label>
      <input
        id="answer-number"
        className="input input--key"
        type="number"
        inputMode="decimal"
        value={current}
        onChange={(event) =>
          onChange({
            kind: 'number',
            value: event.target.value === '' ? Number.NaN : Number(event.target.value),
          })
        }
        placeholder={question.question.placeholder ?? '0'}
        disabled={disabled}
        autoFocus
      />
    </div>
  );
}

/**
 * Ordering uses explicit up/down controls rather than drag and drop: it is
 * keyboard-accessible by construction and impossible to fumble under time
 * pressure on a trackpad (spec section 46).
 */
function OrderingInput({ question, value, onChange, disabled }: Props) {
  const items = question.question.items ?? [];
  const order = value?.kind === 'order' && value.itemIds.length === items.length
    ? value.itemIds
    : items.map((item) => item.id);

  const move = useCallback(
    (index: number, direction: -1 | 1) => {
      if (disabled) return;
      const target = index + direction;
      if (target < 0 || target >= order.length) return;
      const next = [...order];
      const a = next[index] as string;
      const b = next[target] as string;
      next[index] = b;
      next[target] = a;
      onChange({ kind: 'order', itemIds: next });
    },
    [order, onChange, disabled],
  );

  const label = new Map(items.map((item) => [item.id, item.text]));

  return (
    <div className="ordering" role="list" aria-label="Arrange in order">
      <p className="label">Arrange from first to last</p>
      {order.map((id, index) => (
        <motion.div key={id} layout className="ordering__item" role="listitem" transition={{ type: 'spring', stiffness: 460, damping: 34 }}>
          <span className="ordering__index num">{index + 1}</span>
          <span className="ordering__text">{label.get(id) ?? id}</span>
          <span className="ordering__controls">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => move(index, -1)}
              disabled={disabled || index === 0}
              aria-label={`Move ${label.get(id) ?? id} up`}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => move(index, 1)}
              disabled={disabled || index === order.length - 1}
              aria-label={`Move ${label.get(id) ?? id} down`}
            >
              ↓
            </button>
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function MatchingInput({ question, value, onChange, disabled }: Props) {
  const left = question.question.left ?? [];
  const right = question.question.right ?? [];
  const pairs = value?.kind === 'pairs' ? value.pairs : {};

  const set = (leftId: string, rightId: string) => {
    if (disabled) return;
    const next = { ...pairs };
    if (rightId === '') delete next[leftId];
    else next[leftId] = rightId;
    onChange({ kind: 'pairs', pairs: next });
  };

  return (
    <div className="matching">
      <p className="label">Match each item to its pair</p>
      {left.map((item) => (
        <div key={item.id} className="matching__row">
          <span className="matching__left">{item.text}</span>
          <span className="matching__arrow" aria-hidden="true">
            →
          </span>
          <select
            className="select matching__select"
            value={pairs[item.id] ?? ''}
            onChange={(event) => set(item.id, event.target.value)}
            disabled={disabled}
            aria-label={`Pair for ${item.text}`}
          >
            <option value="">Choose…</option>
            {right.map((option) => (
              <option key={option.id} value={option.id}>
                {option.text}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function CodeInput({ question, value, onChange, disabled }: Props) {
  const languages = question.question.languages ?? ['python'];
  const current =
    value?.kind === 'code'
      ? value
      : { kind: 'code' as const, language: languages[0] ?? 'python', source: question.question.starterCode ?? '' };

  return (
    <div className="stack">
      <div className="row">
        <label className="label" htmlFor="answer-language">
          Language
        </label>
        <select
          id="answer-language"
          className="select"
          style={{ width: 160 }}
          value={current.language}
          onChange={(event) =>
            onChange({ ...current, language: event.target.value as typeof current.language })
          }
          disabled={disabled}
        >
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </div>

      <textarea
        className="textarea"
        value={current.source}
        onChange={(event) => onChange({ ...current, source: event.target.value })}
        disabled={disabled}
        spellCheck={false}
        rows={14}
        aria-label="Your code"
      />

      {question.question.samples?.length ? (
        <div className="samples">
          <p className="label">Sample cases</p>
          {question.question.samples.map((sample, index) => (
            <div key={index} className="samples__row">
              <div>
                <span className="eyebrow">Input</span>
                <pre className="code-block">{sample.input}</pre>
              </div>
              <div>
                <span className="eyebrow">Expected</span>
                <pre className="code-block">{sample.output}</pre>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
