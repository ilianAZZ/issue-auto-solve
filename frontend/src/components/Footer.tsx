import { useOverview } from '../api/queries';

export function Footer() {
  const { data } = useOverview();
  return (
    <footer className="mx-auto max-w-[1180px] px-4 py-6 text-center text-xs text-muted sm:px-6">
      <span>v{data?.version ?? '–'}</span>
    </footer>
  );
}
