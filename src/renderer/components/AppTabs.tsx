import React from 'react';
import { L10nTaskState } from '../../shared/l10nTypes';

export type AppView = 'search' | 'string-id';

interface AppTabsProps {
  activeView: AppView;
  l10nState: L10nTaskState;
  onChange: (view: AppView) => void;
}

export const AppTabs: React.FC<AppTabsProps> = ({ activeView, l10nState, onChange }) => (
  <nav className="app-tabs" aria-label="주요 기능">
    <button
      type="button"
      className={`app-tab ${activeView === 'search' ? 'is-active' : ''}`}
      onClick={() => onChange('search')}
    >
      문자열 검색
    </button>
    <button
      type="button"
      className={`app-tab ${activeView === 'string-id' ? 'is-active' : ''}`}
      onClick={() => onChange('string-id')}
    >
      String ID 생성
      <span className={`app-tab-badge badge-${l10nState.stage}`}>
        {l10nState.label}
        {l10nState.attentionCount > 0 ? ` · ${l10nState.attentionCount}` : ''}
      </span>
    </button>
  </nav>
);
