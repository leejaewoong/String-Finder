import React from 'react';
import { L10nTaskState } from '../../shared/l10nTypes';
import { getL10nTabStatus } from '../l10nPresentation';

export type AppView = 'search' | 'string-id';

interface AppTabsProps {
  activeView: AppView;
  l10nState: L10nTaskState;
  onChange: (view: AppView) => void;
}

export const AppTabs: React.FC<AppTabsProps> = ({ activeView, l10nState, onChange }) => {
  const tabStatus = getL10nTabStatus(l10nState);

  return <nav className="app-tabs" aria-label="주요 기능">
    <button
      type="button"
      className={`app-tab ${activeView === 'search' ? 'is-active' : ''}`}
      onClick={() => onChange('search')}
    >
      <span className="app-tab-label">문자열 검색</span>
    </button>
    <button
      type="button"
      className={`app-tab ${activeView === 'string-id' ? 'is-active' : ''}`}
      onClick={() => onChange('string-id')}
    >
      <span className="app-tab-label">String ID 생성</span>
      {tabStatus && (
        <span className={`app-tab-badge badge-${l10nState.stage}`}>{tabStatus}</span>
      )}
    </button>
  </nav>;
};
