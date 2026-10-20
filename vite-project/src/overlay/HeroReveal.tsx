import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { OverlayLayout } from '../shared/types';

interface Transition {
  sequence: number;
  kind: 'panel' | 'left' | 'right';
  fromId?: number;
}

/** Only a changed hero ID starts a transition. Scores, language and snapshots cannot replay it. */
export function HeroReveal({
  heroId,
  layout,
  position,
  renderArt,
  prepareArt,
  caption,
  captionClassName = '',
}: {
  heroId?: number;
  layout: OverlayLayout;
  position: 'left' | 'right';
  renderArt: (id: number | undefined) => ReactNode;
  caption: ReactNode;
  captionClassName?: string;
  prepareArt?: (id: number) => Promise<void>;
}) {
  const previous = useRef(heroId);
  const sequence = useRef(0);
  const [shownHeroId, setShownHeroId] = useState(heroId);
  const shown = useRef(heroId);
  const [transition, setTransition] = useState<Transition | null>(null);
  // Keep presentation options current without making them animation triggers.
  const options = useRef({ layout, position, prepareArt });
  options.current = { layout, position, prepareArt };
  useLayoutEffect(() => {
    if (previous.current === heroId) return;
    const fromId = shown.current;
    previous.current = heroId;
    if (!heroId || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown.current = heroId;
      setShownHeroId(heroId);
      setTransition(null);
      return;
    }
    let active = true;
    setTransition(null);
    let switchTimer: ReturnType<typeof setTimeout>, finishTimer: ReturnType<typeof setTimeout>;
    // Decode before the cover/slide starts. A late image must never reveal an
    // empty slot or replace a newer hero after a quick swap or undo.
    void Promise.resolve(options.current.prepareArt?.(heroId))
      .catch(() => {})
      .then(() => {
        if (!active) return;
        const kind = options.current.layout === 'panel' ? 'panel' : options.current.position;
        setTransition({ sequence: ++sequence.current, kind, fromId });
        switchTimer = setTimeout(
          () => {
            shown.current = heroId;
            setShownHeroId(heroId);
          },
          kind === 'panel' ? 210 : 0,
        );
        finishTimer = setTimeout(() => setTransition(null), kind === 'panel' ? 680 : 430);
      });
    return () => {
      active = false;
      clearTimeout(switchTimer);
      clearTimeout(finishTimer);
    };
  }, [heroId]);
  return (
    <div
      className={transition ? `hero-reveal reveal-${transition.kind}` : 'hero-reveal'}
      data-reveal-sequence={sequence.current}
      data-showing-hero={shownHeroId ?? ''}
    >
      {transition && transition.kind !== 'panel' && (
        <div className="hero-slot broadcast-art reveal-underlay">
          {renderArt(transition.fromId)}
        </div>
      )}
      <div className="hero-slot broadcast-art" data-hero-id={heroId ?? ''}>
        {renderArt(shownHeroId)}
      </div>
      {transition && <div className="reveal-white" key={transition.sequence} aria-hidden="true" />}
      <div
        key={`caption-${transition?.sequence ?? 'idle'}`}
        className={`card-caption ${captionClassName}`.trim()}
      >
        {caption}
      </div>
    </div>
  );
}
