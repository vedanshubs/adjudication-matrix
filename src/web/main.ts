import './styles.css';
import { renderTraceView } from './views/trace.ts';
import { renderCandidateView } from './views/candidate.ts';

type Tab = 'trace' | 'candidate';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="app">
    <h1>Adjudication</h1>
    <span class="badge">v5 taxonomy · deterministic backbone</span>
    <nav class="tabs">
      <button data-tab="trace" class="active">Cascade trace</button>
      <button data-tab="candidate">Candidate</button>
    </nav>
  </header>
  <main id="view"></main>`;

const view = document.querySelector<HTMLElement>('#view')!;
const tabs = app.querySelectorAll<HTMLButtonElement>('nav.tabs button');

function show(tab: Tab): void {
  tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  view.innerHTML = '';
  if (tab === 'trace') renderTraceView(view);
  else renderCandidateView(view);
}

tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab as Tab)));
show('trace');
