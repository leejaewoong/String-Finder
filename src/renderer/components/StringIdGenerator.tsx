import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp } from 'lucide-react';
import {
  L10nConfigStatus,
  L10nDraft,
  L10nFeatureOption,
  L10nInput,
  L10nTaskState,
} from '../../shared/l10nTypes';
import {
  getL10nActionAvailability,
  getFeatureMenuMaxHeight,
  getL10nIssueGroups,
  L10nIssueGroupMode,
  getL10nTaskTitle,
  isL10nBusy,
  shouldSuggestReleaseDate,
} from '../l10nPresentation';
import { StatusBar } from './StatusBar';

interface StringIdGeneratorProps {
  taskState: L10nTaskState;
  draft: L10nDraft;
  onDraftChange: (changes: Partial<L10nDraft>) => void;
  onStateChange: (state: L10nTaskState) => void;
  onCancel: () => Promise<void>;
  onComplete: () => Promise<void>;
  lastUpdateTime?: string | null;
}

const STAGE_LABELS = ['입력 확인', 'String ID 생성', '위키 검토 대기', 'JSON 반영'];

interface FieldLabelProps {
  htmlFor: string;
  title: string;
  help: string;
}

const FieldLabel: React.FC<FieldLabelProps> = ({ htmlFor, title, help }) => (
  <div className="l10n-field-heading">
    <label className="l10n-field-title" htmlFor={htmlFor}>{title}</label>
    <span className="l10n-field-help">
      <button
        type="button"
        className="l10n-field-help-trigger"
        aria-label={`${title} 도움말`}
        aria-describedby={`${htmlFor}-help`}
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      <span id={`${htmlFor}-help`} className="l10n-field-tooltip" role="tooltip">
        {help}
      </span>
    </span>
  </div>
);

function splitUrls(value: string): string[] {
  return value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function formatTime(value?: string): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export const StringIdGenerator: React.FC<StringIdGeneratorProps> = ({
  taskState,
  draft,
  onDraftChange,
  onStateChange,
  onCancel,
  onComplete,
  lastUpdateTime,
}) => {
  const [dateWarning, setDateWarning] = useState('');
  const [config, setConfig] = useState<L10nConfigStatus | null>(null);
  const [featureOptions, setFeatureOptions] = useState<L10nFeatureOption[]>([]);
  const [actionError, setActionError] = useState('');
  const [isFeatureMenuOpen, setIsFeatureMenuOpen] = useState(false);
  const [isFeatureFiltering, setIsFeatureFiltering] = useState(false);
  const [activeFeatureIndex, setActiveFeatureIndex] = useState(0);
  const [featureMenuMaxHeight, setFeatureMenuMaxHeight] = useState(280);
  const [issueGroupMode, setIssueGroupMode] = useState<L10nIssueGroupMode>('frame');
  const lastSuggestedInput = useRef('');
  const featureComboboxRef = useRef<HTMLDivElement>(null);
  const featureInputRef = useRef<HTMLInputElement>(null);
  const featureMenuRef = useRef<HTMLUListElement>(null);
  const figmaUrls = splitUrls(draft.figmaText);
  const inputReady = Boolean(draft.wikiUrl.trim()
    && figmaUrls.length
    && /^[A-Z0-9_]+$/.test(draft.featurePrefix)
    && /^20\d{2}-\d{2}-\d{2}$/.test(draft.releaseDate));
  const isComplete = taskState.stage === 'complete';
  const canCancel = taskState.canCancel
    || (taskState.stage === 'idle' && Boolean(draft.taskTitle));
  const featureQuery = draft.featurePrefix.trim();
  const visibleFeatureOptions = isFeatureFiltering && featureQuery
    ? featureOptions.filter((option) => option.prefix.startsWith(featureQuery))
    : featureOptions;
  const issueGroups = getL10nIssueGroups(taskState.issues, issueGroupMode);
  const actionAvailability = getL10nActionAvailability(taskState, draft);

  const updateFeatureMenuHeight = () => {
    const input = featureInputRef.current;
    if (!input) return;
    setFeatureMenuMaxHeight(getFeatureMenuMaxHeight(
      window.innerHeight,
      input.getBoundingClientRect().bottom,
    ));
  };

  const openFeatureMenu = (filtering: boolean) => {
    setIsFeatureFiltering(filtering);
    setIsFeatureMenuOpen(true);
    updateFeatureMenuHeight();
  };

  const selectFeature = (prefix: string) => {
    onDraftChange({ featurePrefix: prefix });
    setIsFeatureMenuOpen(false);
    setIsFeatureFiltering(false);
    featureInputRef.current?.focus();
  };

  const refreshConfig = async () => {
    const next = await window.electron.getL10nConfig();
    setConfig(next);
    return next;
  };

  useEffect(() => {
    refreshConfig().catch((error) => setActionError(String(error)));
    window.electron.getL10nFeatureOptions()
      .then(setFeatureOptions)
      .catch(() => setFeatureOptions([]));
  }, []);

  useEffect(() => {
    if (!isFeatureMenuOpen) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!featureComboboxRef.current?.contains(event.target as Node)) {
        setIsFeatureMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('scroll', updateFeatureMenuHeight, true);
    window.addEventListener('resize', updateFeatureMenuHeight);
    updateFeatureMenuHeight();
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('scroll', updateFeatureMenuHeight, true);
      window.removeEventListener('resize', updateFeatureMenuHeight);
    };
  }, [isFeatureMenuOpen]);

  useEffect(() => {
    if (!isFeatureMenuOpen) return;
    setActiveFeatureIndex((current) => Math.min(
      current,
      Math.max(0, visibleFeatureOptions.length - 1),
    ));
  }, [isFeatureMenuOpen, visibleFeatureOptions.length]);

  useEffect(() => {
    if (!isFeatureMenuOpen) return;
    const activeOption = featureMenuRef.current?.children[activeFeatureIndex] as HTMLElement | undefined;
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [activeFeatureIndex, isFeatureMenuOpen]);

  useEffect(() => {
    if (!shouldSuggestReleaseDate(draft, figmaUrls, Boolean(config?.configured))) return;
    const suggestionInput = [draft.wikiUrl.trim(), ...figmaUrls].join('\u0000');
    if (draft.releaseDateSource === 'auto'
      && draft.releaseDate
      && lastSuggestedInput.current === suggestionInput) return;
    let active = true;
    const suggest = async () => {
      try {
        const suggestion = await window.electron.suggestL10nReleaseDate(draft.wikiUrl.trim(), figmaUrls);
        if (active) {
          if (suggestion.releaseDate) {
            lastSuggestedInput.current = suggestionInput;
            onDraftChange({ releaseDate: suggestion.releaseDate, releaseDateSource: 'auto' });
          }
          setDateWarning(suggestion.warning ?? '');
        }
      } catch {
        // 입력이 바뀌거나 외부 조회가 실패하면 다음 입력에서 다시 시도합니다.
      }
    };
    suggest().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    draft.wikiUrl,
    draft.figmaText,
    draft.releaseDate,
    draft.releaseDateSource,
    config?.configured,
    onDraftChange,
  ]);

  const buildInput = (): L10nInput => ({
    wikiUrl: draft.wikiUrl.trim(),
    figmaUrls,
    featurePrefix: draft.featurePrefix,
    releaseDate: draft.releaseDate,
    releaseDateSource: draft.releaseDateSource,
  });

  const runAction = async (action: 'generate' | 'finalize') => {
    setActionError('');
    try {
      const result = action === 'generate'
        ? await window.electron.generateL10nStringIds(buildInput())
        : await window.electron.finalizeL10nStringIds(buildInput());
      onStateChange(result.state);
      if (result.state.error) setActionError(result.state.error);
    } catch (error) {
      setActionError(String(error).replace(/^Error:\s*/, ''));
      await refreshConfig();
    }
  };

  const stageIndex = taskState.stage === 'complete'
    ? 4
    : taskState.stage === 'json-applying'
      ? 3
      : taskState.stage === 'wiki-review'
        ? 2
        : taskState.stage === 'idle' || taskState.stage === 'input'
          ? 0
          : 1;

  return (
    <>
      <main className="l10n-screen">
      <div className="l10n-heading-row">
        <div>
          <h2>{getL10nTaskTitle(taskState, draft)}</h2>
        </div>
        <div className="l10n-actions">
          {!isComplete && (
            <button
              type="button"
              className="l10n-button is-cancel"
              disabled={!canCancel}
              onClick={onCancel}
            >
              작업 취소
            </button>
          )}
          <button
            type="button"
            className="l10n-button is-generate"
            disabled={!config?.configured || !inputReady || !actionAvailability.canGenerate}
            onClick={() => runAction('generate')}
          >
            String ID 생성
          </button>
          <button
            type="button"
            className="l10n-button is-finalize"
            disabled={!isComplete && (!config?.configured || !inputReady || !actionAvailability.canFinalize)}
            onClick={isComplete ? onComplete : () => runAction('finalize')}
          >
            {isComplete ? '완료' : 'JSON 반영'}
          </button>
        </div>
      </div>

      {!config?.configured && config && (
        <section className="l10n-config-alert" aria-live="polite">
          <div>
            <strong>연결 설정이 필요합니다</strong>
            <p>{config.missing.join(', ')} 값을 설정하면 바로 사용할 수 있습니다.</p>
            <code>{config.envPath}</code>
          </div>
          <button type="button" onClick={async () => {
            await window.electron.openL10nEnv();
            await refreshConfig();
          }}>
            설정 파일 열기
          </button>
        </section>
      )}

      <div className="l10n-grid">
        <section className="l10n-panel l10n-input-panel">
          <h3>입력</h3>
          <div className="l10n-field">
            <FieldLabel
              htmlFor="l10n-figma-file"
              title="FIGMA FILE"
              help="스트링 태그의 타겟 텍스트 레이어 값을 추적하여 위키를 업데이트하고 String ID를 제안합니다."
            />
            <input
              id="l10n-figma-file"
              value={draft.figmaText}
              onChange={(event) => onDraftChange({ figmaText: event.target.value })}
              placeholder={'스트링 태그가 포함된 프레임이 있는 페이지 링크를 입력하세요.'}
            />
          </div>
          <div className="l10n-field">
            <FieldLabel
              htmlFor="l10n-wiki-page"
              title="WIKI PAGE"
              help="FIGMA FILE의 텍스트와 비교하여 테이블을 최신화하고 String ID를 추천합니다.</br>테이블이 없는 경우 테이블을 생성합니다."
            />
            <input
              id="l10n-wiki-page"
              value={draft.wikiUrl}
              onChange={(event) => onDraftChange({ wikiUrl: event.target.value })}
              placeholder="String ID 테이블이 있는 위키 페이지 링크를 입력하세요."
            />
          </div>
          <div className="l10n-field">
            <FieldLabel
              htmlFor="l10n-feature-prefix"
              title="FEATURE PREFIX"
              help="String ID 생성 시 적용할 Feature Prefix를 선택하세요.</br>신규 피쳐일 경우에는 직접 작성할 수 있습니다."
            />
            <div className="l10n-feature-combobox" ref={featureComboboxRef}>
              <input
                id="l10n-feature-prefix"
                ref={featureInputRef}
                className="l10n-feature-input"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isFeatureMenuOpen}
                aria-controls="l10n-feature-prefix-list"
                aria-activedescendant={isFeatureMenuOpen && visibleFeatureOptions.length
                  ? `l10n-feature-option-${activeFeatureIndex}`
                  : undefined}
                value={draft.featurePrefix}
                onFocus={() => {
                  const selectedIndex = featureOptions.findIndex(
                    (option) => option.prefix === draft.featurePrefix,
                  );
                  setActiveFeatureIndex(Math.max(0, selectedIndex));
                  openFeatureMenu(false);
                }}
                onChange={(event) => {
                  onDraftChange({
                    featurePrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
                  });
                  setActiveFeatureIndex(0);
                  openFeatureMenu(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (!isFeatureMenuOpen) openFeatureMenu(false);
                    setActiveFeatureIndex((current) => Math.min(
                      current + 1,
                      Math.max(0, visibleFeatureOptions.length - 1),
                    ));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (!isFeatureMenuOpen) openFeatureMenu(false);
                    setActiveFeatureIndex((current) => Math.max(0, current - 1));
                  } else if (event.key === 'Enter' && isFeatureMenuOpen) {
                    event.preventDefault();
                    const selected = visibleFeatureOptions[activeFeatureIndex];
                    if (selected) selectFeature(selected.prefix);
                  } else if (event.key === 'Escape') {
                    setIsFeatureMenuOpen(false);
                  }
                }}
                placeholder="String ID 생성 시 적용할 Feature Prefix를 선택하세요."
                autoComplete="on"
              />
              <button
                type="button"
                className="l10n-feature-toggle"
                aria-label={isFeatureMenuOpen ? '피쳐 목록 닫기' : '피쳐 목록 열기'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (isFeatureMenuOpen) {
                    setIsFeatureMenuOpen(false);
                  } else {
                    featureInputRef.current?.focus();
                    openFeatureMenu(false);
                  }
                }}
              >
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {isFeatureMenuOpen && visibleFeatureOptions.length > 0 && (
                <ul
                  id="l10n-feature-prefix-list"
                  ref={featureMenuRef}
                  className="l10n-feature-menu"
                  role="listbox"
                  style={{ maxHeight: featureMenuMaxHeight }}
                >
                  {visibleFeatureOptions.map((option, index) => (
                    <li key={option.prefix} role="none">
                      <button
                        id={`l10n-feature-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={draft.featurePrefix === option.prefix}
                        className={`l10n-feature-option${index === activeFeatureIndex ? ' is-active' : ''}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveFeatureIndex(index)}
                        onClick={() => selectFeature(option.prefix)}
                      >
                        {option.prefix}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="l10n-field">
            <FieldLabel
              htmlFor="l10n-release-date"
              title="RELEASE DATE"
              help="String 값 입력 시 포함할 Release Date를 입력하세요."
            />
            <input
              id="l10n-release-date"
              type="date"
              value={draft.releaseDate}
              onChange={(event) => {
                onDraftChange({ releaseDate: event.target.value, releaseDateSource: 'manual' });
                setDateWarning('');
              }}
            />
          </div>
          {dateWarning && <p className="l10n-inline-warning">{dateWarning}</p>}
          {(actionError || taskState.error) && (
            <p className="l10n-error" role="alert">{actionError || taskState.error}</p>
          )}
        </section>

        <section className="l10n-panel l10n-status-panel">
          <div className="l10n-panel-title">
            <h3>작업 상태</h3>
            {taskState.attentionCount > 0 && <span>{taskState.attentionCount}개 확인 필요</span>}
          </div>
          {isL10nBusy(taskState.stage) && (
            <div
              className="l10n-progress-track"
              role="progressbar"
              aria-label={taskState.label}
            >
              <span />
            </div>
          )}
          <div className="l10n-stage-list">
            {STAGE_LABELS.map((label, index) => {
              const isDone = index < stageIndex || taskState.stage === 'complete';
              const isCurrent = index === stageIndex && taskState.stage !== 'idle';
              return (
                <div className={isDone ? 'is-done' : isCurrent ? 'is-current' : 'is-later'} key={label}>
                  <span>{isDone ? '✓' : isCurrent ? '●' : '○'}</span>
                  {isCurrent ? taskState.label : label}
                </div>
              );
            })}
          </div>
          <dl className="l10n-stats">
            <div><dt>기존 키 재사용</dt><dd>{taskState.stats.reused}</dd></div>
            <div><dt>신규 추가 예정</dt><dd>{taskState.stats.created + taskState.stats.renumbered}</dd></div>
            <div><dt>COMMON 추천</dt><dd>{taskState.stats.common}</dd></div>
            <div><dt>마지막 생성</dt><dd>{formatTime(taskState.lastGeneratedAt)}</dd></div>
          </dl>
          {taskState.issues.length > 0 && (
            <details className="l10n-issues">
              <summary>확인 필요한 항목 보기 ({taskState.issues.length})</summary>
              <div className="l10n-issue-view-toggle" role="group" aria-label="확인 항목 보기 방식">
                <button
                  type="button"
                  className={issueGroupMode === 'frame' ? 'is-active' : ''}
                  aria-pressed={issueGroupMode === 'frame'}
                  onClick={() => setIssueGroupMode('frame')}
                >
                  프레임별
                </button>
                <button
                  type="button"
                  className={issueGroupMode === 'status' ? 'is-active' : ''}
                  aria-pressed={issueGroupMode === 'status'}
                  onClick={() => setIssueGroupMode('status')}
                >
                  상태별
                </button>
              </div>
              <div className="l10n-issue-groups">
                {issueGroups.map((group) => (
                  <section className="l10n-issue-group" key={group.key}>
                    <h4>{group.title}</h4>
                    <ul>
                      {group.issues.map((issue, index) => (
                        <li key={`${issue.code}-${issue.rowKey ?? index}`}>
                          <div className="l10n-issue-heading">
                            {issueGroupMode === 'frame' && <strong>{issue.label}</strong>}
                            <span className="l10n-issue-locator">
                              {issueGroupMode === 'status' && (
                                <>
                                  <span>{issue.frameName?.trim() || '기타'}</span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              {issue.delimiter && <b>{issue.delimiter}</b>}
                              {issue.delimiter && issue.korean && <span aria-hidden="true">·</span>}
                              {issue.korean || '내용 확인 필요'}
                            </span>
                            {issue.reference && (
                              <span className="l10n-issue-reference">{issue.reference}</span>
                            )}
                          </div>
                          <p>{issue.message}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
      </main>
      <StatusBar lastUpdateTime={lastUpdateTime ?? null} />
    </>
  );
};
