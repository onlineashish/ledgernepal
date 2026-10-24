/**
 * Runs work after the HTTP response has gone out, e.g. sending an email. "Forgot password" answers
 * instantly and identically for every address; doing the lookup and mailing afterwards means the
 * response time cannot reveal whether an account exists.
 *
 * Failures are logged, never thrown. `idle()` resolves when everything started so far has finished:
 * tests await it, and shutdown waits for it so a deploy does not drop an email.
 */
export function createBackgroundTasks(logger) {
  const pending = new Set();
  return {
    run(promise, label) {
      const tracked = promise
        .catch((err) => logger.error({ err, label }, 'Background task failed'))
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
