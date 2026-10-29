export function createReferenceDataController({ referenceDataRepository, activityService }) {
  return {
    async trucks(_req, res) {
      res.json({ data: await referenceDataRepository.listTrucks() });
    },
    async cargoTypes(_req, res) {
      res.json({ data: await referenceDataRepository.listCargoTypes() });
    },
    async activity(req, res) {
      res.json({ data: await activityService.list({ limit: req.validated.query.limit }) });
    },
  };
}
