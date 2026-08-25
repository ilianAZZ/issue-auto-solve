import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { onUnauthorized } from './api/client';
import { useOverview, useSetupStatus } from './api/queries';
import { Header } from './components/Header';
import { StatsGrid } from './components/StatsGrid';
import { UsageByRepo } from './components/UsageByRepo';
import { FilterBar } from './components/FilterBar';
import { TaskTable } from './components/TaskTable';
import { TaskDrawer } from './components/TaskDrawer';
import { SetupOverlay } from './components/SetupOverlay';
import { LoginScreen } from './components/LoginScreen';
import { ErrorBanner } from './components/ErrorBanner';
import { ClaudeTokenAlert } from './components/ClaudeTokenAlert';
import { UsageLimitAlert } from './components/UsageLimitAlert';
import { Footer } from './components/Footer';
import { filtersFromSearch, searchFromFilters } from './lib/filterUrl';
import { getLocation, navigate, subscribeToLocation } from './lib/location';
import type { TaskFilters } from './types';

export default function App() {
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => onUnauthorized(() => setUnauthorized(true)), []);

  const location = useSyncExternalStore(subscribeToLocation, getLocation, getLocation);
  const filters = filtersFromSearch(location.search);
  const setFilters = (next: TaskFilters) => navigate(`${location.pathname}${searchFromFilters(next)}`, { replace: true });

  const overview = useOverview();
  const setupStatus = useSetupStatus();
  const setupOpen = location.pathname === '/config';
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpened.current && setupStatus.data) {
      autoOpened.current = true;
      if (!setupStatus.data.complete && location.pathname !== '/config') navigate(`/config${location.search}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupStatus.data]);

  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const openSetup = () => navigate(`/config${location.search}`);
  const closeSetup = () => navigate(`/${location.search}`);

  if (unauthorized) {
    return (
      <>
        <ErrorBanner />
        <LoginScreen />
      </>
    );
  }

  return (
    <>
      <ErrorBanner />
      {overview.data?.claude_token_invalid && <ClaudeTokenAlert onOpenSetup={openSetup} />}
      {overview.data?.usage_limit_active && <UsageLimitAlert retryAt={overview.data.usage_limit_retry_at} />}
      <Header onOpenSetup={openSetup} />
      <main className="mx-auto max-w-[1180px] px-6 py-6">
        <StatsGrid filters={filters} onChange={setFilters} />
        <UsageByRepo />
        <FilterBar filters={filters} onChange={setFilters} />
        <TaskTable filters={filters} onOpenTask={setOpenTaskId} />
      </main>
      <Footer />
      {openTaskId != null && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
      {setupOpen && <SetupOverlay onClose={closeSetup} />}
    </>
  );
}
