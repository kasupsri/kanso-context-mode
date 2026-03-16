import { AppState } from './app-state.js';

let appState: AppState | null = null;

export function getAppState(): AppState {
  if (!appState) {
    appState = new AppState();
  }
  return appState;
}

export function resetAppStateForTests(): void {
  if (appState) {
    appState.close();
    appState = null;
  }
}
