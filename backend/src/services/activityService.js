/**
 * Records business events in activity_logs. Failures to write an activity entry
 * are logged but never fail the user's request, because the activity log is
 * secondary to the operation it describes.
 */
export function createActivityService({ activityRepository, logger }) {
  return {
    async record(event) {
      try {
        await activityRepository.record(event);
      } catch (err) {
        logger.warn({ err: { message: err.message, code: err.code }, eventType: event.eventType }, 'Activity log write failed');
      }
    },
    list: (opts) => activityRepository.list(opts),
  };
}
