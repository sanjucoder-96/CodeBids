/**
 * Surface router.
 *
 * Three surfaces live in one bundle so the event needs exactly one build and
 * one server. Routing is pathname-based (no router dependency) and works with
 * the server's SPA fallback:
 *
 *   /            participant client
 *   /organizer   operator dashboard
 *   /projector   hall display
 */

import { useEffect, useState } from 'react';
import { ParticipantApp } from './participant/ParticipantApp.js';
import { OrganizerApp } from './organizer/OrganizerApp.js';
import { ProjectorApp } from './projector/ProjectorApp.js';
import { ConnectionBanner, Flash, Toasts } from './ui/Overlays.js';

export type Surface = 'participant' | 'organizer' | 'projector';

export function surfaceFromPath(pathname: string): Surface {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/organizer' || path.startsWith('/organizer/')) return 'organizer';
  if (path === '/projector' || path.startsWith('/projector/')) return 'projector';
  return 'participant';
}

export function App() {
  const [surface, setSurface] = useState<Surface>(() => surfaceFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setSurface(surfaceFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title =
      surface === 'organizer'
        ? 'Code Market — Organizer'
        : surface === 'projector'
          ? 'Code Market — Live'
          : 'Code Market';
  }, [surface]);

  return (
    <>
      <ConnectionBanner />
      {surface === 'organizer' ? (
        <OrganizerApp />
      ) : surface === 'projector' ? (
        <ProjectorApp />
      ) : (
        <ParticipantApp />
      )}
      {surface !== 'projector' ? <Toasts /> : null}
      <Flash />
    </>
  );
}
