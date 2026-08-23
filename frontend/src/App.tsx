import { useEffect, useRef, useState } from 'react';
import { onUnauthorized } from './api/client';
import { useSetupStatus } from './api/queries';
import { Header } from './components/Header';
import { StatsGrid } from './components/StatsGrid';
import { FilterBar } from './components/FilterBar';
import { TaskTable } from './components/TaskTable';
import { TaskDrawer } from './components/TaskDrawer';
import { SetupOverlay } from './components/SetupOverlay';
import { LoginScreen } from './components/LoginScreen';
import { DEFAULT_STATE_FILTERS } from './lib/constants';
import type { TaskFilters } from './types';

export default function App() {
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => onUnauthorized(() => setUnauthorized(true)), []);

  const setupStatus = useSetupStatus();
  const [setupOpen, setSetupOpen] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpened.current && setupStatus.data) {
      autoOpened.current = true;
      if (!setupStatus.data.complete) setSetupOpen(true);
    }
  }, [setupStatus.data]);

  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({ states: new Set(DEFAULT_STATE_FILTERS), repo: '', q: '' });

  if (unauthorized) return <LoginScreen />;

  return (
    <>
      <Header onOpenSetup={() => setSetupOpen(true)} />
      <main className="mx-auto max-w-[1180px] px-6 py-6">
        <StatsGrid />
        <FilterBar filters={filters} onChange={setFilters} />
        <TaskTable filters={filters} onOpenTask={setOpenTaskId} />
      </main>
      {openTaskId != null && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
      {setupOpen && <SetupOverlay onClose={() => setSetupOpen(false)} />}
    </>
  );
}
