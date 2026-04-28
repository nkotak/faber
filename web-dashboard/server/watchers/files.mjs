// watchers/files.mjs - chokidar watchers that emit semantic events.
//
// Debounced at 150ms per path so a multi-write operation (e.g. the
// tracker merge script rewriting applications.md) produces ONE event,
// not a volley. Emitted event shape:
//
//   { kind: 'applications' | 'pipeline' | 'reports' | 'output' | 'interview-prep' | 'onboarding', path }

import chokidar from 'chokidar';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const DEBOUNCE_MS = 150;

function debouncedEmit(emitter, kind) {
  let timer = null;
  let latest = null;
  return (p) => {
    latest = p;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      emitter.emit('change', { kind, path: latest });
    }, DEBOUNCE_MS);
  };
}

export function startWatchers(careerOpsRoot) {
  const emitter = new EventEmitter();

  const appsWatcher = chokidar.watch(
    [
      path.join(careerOpsRoot, 'applications.md'),
      path.join(careerOpsRoot, 'data', 'applications.md'),
    ],
    { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 } },
  );
  const appsDebounced = debouncedEmit(emitter, 'applications');
  appsWatcher.on('change', appsDebounced).on('add', appsDebounced);

  const pipelineWatcher = chokidar.watch(
    [
      path.join(careerOpsRoot, 'pipeline.md'),
      path.join(careerOpsRoot, 'data', 'pipeline.md'),
    ],
    { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 } },
  );
  const pipelineDebounced = debouncedEmit(emitter, 'pipeline');
  pipelineWatcher.on('change', pipelineDebounced).on('add', pipelineDebounced);

  const reportsWatcher = chokidar.watch(path.join(careerOpsRoot, 'reports'), {
    ignoreInitial: true,
    depth: 1,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 40 },
  });
  const reportsDebounced = debouncedEmit(emitter, 'reports');
  reportsWatcher.on('add', reportsDebounced).on('change', reportsDebounced).on('unlink', reportsDebounced);

  const outputWatcher = chokidar.watch(path.join(careerOpsRoot, 'output'), {
    ignoreInitial: true,
    depth: 1,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  const outputDebounced = debouncedEmit(emitter, 'output');
  outputWatcher.on('add', outputDebounced).on('unlink', outputDebounced);

  const prepWatcher = chokidar.watch(path.join(careerOpsRoot, 'interview-prep'), {
    ignoreInitial: true,
    depth: 1,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 40 },
  });
  const prepDebounced = debouncedEmit(emitter, 'interview-prep');
  prepWatcher.on('add', prepDebounced).on('change', prepDebounced).on('unlink', prepDebounced);

  // Onboarding watcher: covers the four required user-layer files plus the
  // staging artifact cv-imported.md. Any change here invalidates the
  // onboarding status query so the modal can advance / unmount.
  const onboardingWatcher = chokidar.watch(
    [
      path.join(careerOpsRoot, 'cv.md'),
      path.join(careerOpsRoot, 'cv-imported.md'),
      path.join(careerOpsRoot, 'config', 'profile.yml'),
      path.join(careerOpsRoot, 'modes', '_profile.md'),
      path.join(careerOpsRoot, 'portals.yml'),
    ],
    { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 } },
  );
  const onboardingDebounced = debouncedEmit(emitter, 'onboarding');
  onboardingWatcher
    .on('add', onboardingDebounced)
    .on('change', onboardingDebounced)
    .on('unlink', onboardingDebounced);

  const close = async () => {
    await Promise.all([
      appsWatcher.close(),
      pipelineWatcher.close(),
      reportsWatcher.close(),
      outputWatcher.close(),
      prepWatcher.close(),
      onboardingWatcher.close(),
    ]);
  };

  return { emitter, close };
}
