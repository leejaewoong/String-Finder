import React, { useEffect, useRef, useState } from 'react';
import {
  L10nConfigStatus,
  L10nInput,
  L10nTaskState,
} from '../../shared/l10nTypes';

interface StringIdGeneratorProps {
  taskState: L10nTaskState;
  onStateChange: (state: L10nTaskState) => void;
}

const STAGE_LABELS = ['입력 확인', 'String ID 생성', '위키 검토 대기', 'JSON 반영'];

function splitUrls(value: string): string[] {
  return value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function formatTime(value?: string): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export const StringIdGenerator: React.FC<StringIdGeneratorProps> = ({
  taskState,
  onStateChange,
}) => {
  const [wikiUrl, setWikiUrl] = useState('');
  const [figmaText, setFigmaText] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [dateWarning, setDateWarning] = useState('');
  const [config, setConfig] = useState<L10nConfigStatus | null>(null);
  const [actionError, setActionError] = useState('');
  const manualDate = useRef(false);
  const figmaUrls = splitUrls(figmaText);
  const inputReady = Boolean(wikiUrl.trim() && figmaUrls.length && /^20\d{2}-\d{2}-\d{2}$/.test(releaseDate));

  const refreshConfig = async () => {
    const next = await window.electron.getL10nConfig();
    setConfig(next);
    return next;
  };

  useEffect(() => {
    refreshConfig().catch((error) => setActionError(String(error)));
  }, []);

  useEffect(() => {
    if (manualDate.current || !config?.configured || (!wikiUrl.trim() && figmaUrls.length === 0)) return;
    let active = true;
    const timeout = window.setTimeout(async () => {
      try {
        const suggestion = await window.electron.suggestL10nReleaseDate(wikiUrl.trim(), figmaUrls);
        if (active && !manualDate.current) {
          if (suggestion.releaseDate) setReleaseDate(suggestion.releaseDate);
          setDateWarning(suggestion.warning ?? '');
        }
      } catch {
        // Partial URLs are expected while the user is typing.
      }
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [wikiUrl, figmaText, config?.configured]);

  const buildInput = (): L10nInput => ({
    wikiUrl: wikiUrl.trim(),
    figmaUrls,
    releaseDate,
    releaseDateSource: manualDate.current ? 'manual' : 'auto',
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
    <main className="l10n-screen">
      <div className="l10n-heading-row">
        <div>
          <h2>새 String ID 작업</h2>
          <p>Figma와 위키를 바탕으로 String ID를 생성합니다.</p>
        </div>
        <div className="l10n-actions">
          <button
            type="button"
            className="l10n-button is-cancel"
            disabled={!taskState.canCancel}
            onClick={async () => onStateChange(await window.electron.cancelL10nTask())}
          >
            작업 취소
          </button>
          <button
            type="button"
            className="l10n-button is-generate"
            disabled={!config?.configured || !inputReady || !taskState.canGenerate}
            onClick={() => runAction('generate')}
          >
            String ID 생성
          </button>
          <button
            type="button"
            className="l10n-button is-finalize"
            disabled={!config?.configured || !inputReady || !taskState.canFinalize}
            onClick={() => runAction('finalize')}
          >
            최종 확정
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
          <label className="l10n-field">
            <span>WIKI PAGE</span>
            <input
              value={wikiUrl}
              onChange={(event) => setWikiUrl(event.target.value)}
              placeholder="https://krafton.atlassian.net/wiki/..."
            />
          </label>
          <label className="l10n-field">
            <span>FIGMA PAGES</span>
            <textarea
              value={figmaText}
              onChange={(event) => setFigmaText(event.target.value)}
              placeholder={'Figma URL을 한 줄에 하나씩 입력하세요.\nhttps://www.figma.com/design/...'}
            />
          </label>
          <label className="l10n-field">
            <span>RELEASE DATE</span>
            <input
              type="date"
              value={releaseDate}
              onChange={(event) => {
                manualDate.current = true;
                setReleaseDate(event.target.value);
                setDateWarning('');
              }}
            />
          </label>
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
              <summary>확인 필요한 항목 보기</summary>
              <ul>
                {taskState.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.rowKey ?? index}`}>
                    <strong>{issue.code}</strong>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </main>
  );
};
