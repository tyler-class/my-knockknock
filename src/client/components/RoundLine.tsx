import { useData } from '../lib/queries';

/**
 * "Round: Fall 2026" under a page's heading, on every page that follows the search picked in
 * the sidebar (or the top bar on phones), so it's clear which one you're looking at.
 */
export function RoundLine() {
  const data = useData();
  if (!data?.round) return null;
  return (
    <p className="page-sub sub search-line">
      <strong>Round:</strong> {data.round.name}
    </p>
  );
}
