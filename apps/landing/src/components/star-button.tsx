import { useEffect, useState } from 'react';

import { GitHubIcon } from '@/components/ui';
import { LINKS } from '@/links';

const REPO_API = 'https://api.github.com/repos/tun2g/taskbot';
const CACHE_KEY = 'taskbot-stars';

/** Reads the star count once per session (the unauthenticated GitHub API allows 60 requests an hour per IP). */
function useStarCount() {
  const [stars, setStars] = useState<number | null>(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      return cached ? Number(cached) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (stars !== null) return;
    const ctrl = new AbortController();
    fetch(REPO_API, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((repo: { stargazers_count?: number } | null) => {
        if (typeof repo?.stargazers_count !== 'number') return;
        setStars(repo.stargazers_count);
        try {
          sessionStorage.setItem(CACHE_KEY, String(repo.stargazers_count));
        } catch {
          // Storage blocked: the count just gets fetched again next time.
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [stars]);

  return stars;
}

function formatCount(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function StarButton({ className = '' }: { className?: string }) {
  const stars = useStarCount();
  return (
    <a
      href={LINKS.github}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={stars === null ? 'Star TaskBot on GitHub' : `Star TaskBot on GitHub, ${stars} stars`}
      className={`group inline-flex h-10 items-stretch overflow-hidden rounded-xl border border-line-strong/70 bg-surface/60 text-sm font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface ${className}`}
    >
      <span className="flex items-center gap-2 px-3">
        <GitHubIcon className="size-4" />
        <StarIcon />
        Star
      </span>
      {stars !== null && (
        <span className="flex items-center border-l border-line-strong/70 bg-surface-2/60 px-3 tabular-nums text-ink-2">
          {formatCount(stars)}
        </span>
      )}
    </a>
  );
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 text-ink-3 transition-colors group-hover:text-[#e3b341]"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 .9l2.1 4.4 4.8.6-3.5 3.3.9 4.8L8 11.7 3.7 14l.9-4.8L1.1 5.9l4.8-.6L8 .9z" />
    </svg>
  );
}
