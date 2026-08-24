import { useOverview } from '../api/queries';

export function Footer() {
  const { data } = useOverview();
  return (
    <footer className="mx-auto max-w-[1180px] px-6 py-6 text-center text-xs text-muted">
      <span>v{data?.version ?? '–'}</span>
    </footer>
  );
}
