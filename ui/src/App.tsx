import { CenterPane } from "./components/CenterPane";
import { LeftPane } from "./components/LeftPane";
import { RightPane } from "./components/RightPane";
import { CockpitProvider, useCockpit } from "./state/cockpit";

function ErrorBar() {
  const { state, actions } = useCockpit();
  if (!state.error) return null;
  return (
    <div className="error-bar">
      <span>{state.error}</span>
      <button type="button" onClick={actions.clearError}>
        dismiss
      </button>
    </div>
  );
}

export function App() {
  return (
    <CockpitProvider>
      <div className="app">
        <ErrorBar />
        <div className="cockpit">
          <LeftPane />
          <CenterPane />
          <RightPane />
        </div>
      </div>
    </CockpitProvider>
  );
}
