export function createCalculationController({ calculationService }) {
  return {
    async estimate(req, res) {
      const result = await calculationService.estimate(req.validated.body);
      res.json({ data: result });
    },

    async create(req, res) {
      const saved = await calculationService.save(req.validated.body, { requestId: req.id });
      res.status(201).location(`/api/calculations/${saved.id}`).json({ data: saved });
    },

    async list(req, res) {
      const { limit, offset } = req.validated.query;
      const { items, total } = await calculationService.list({ limit, offset });
      res.json({ data: items, meta: { total, limit, offset } });
    },

    async get(req, res) {
      res.json({ data: await calculationService.get(req.validated.params.id) });
    },

    async remove(req, res) {
      res.json({ data: await calculationService.remove(req.validated.params.id, { requestId: req.id }) });
    },
  };
}
