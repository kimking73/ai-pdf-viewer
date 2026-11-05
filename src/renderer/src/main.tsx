import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../../shared/app-config';
import { App } from './App';
import { SettingsApp } from './settings/SettingsApp';
import './main.css';

// 설정 창은 같은 번들을 #settings로 연다(docs/design-contract.md 4.10절).
const isSettings = window.location.hash === '#settings';
document.title = isSettings ? '설정' : APP_NAME;

const container = document.getElementById('root');
if (container === null) throw new Error('#root 요소가 없다');

createRoot(container).render(
  <StrictMode>
    {isSettings ? <SettingsApp /> : <App />}
  </StrictMode>,
);
