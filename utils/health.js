import express from "express";
import mongoose from "mongoose";

// The database connection is the one thing a request cannot do without, so
// readiness is read from it rather than assumed. `readyState === 1` is
// mongoose's "connected"; anything else means a request would wait or fail.
export const isDatabaseReady = () => mongoose.connection.readyState === 1;

// Two probes, because they answer two different questions and a platform acts
// on them differently. Liveness only asks whether the process is still serving:
// it must not look at the database, or a short database outage would have every
// instance restarted at once. Readiness asks whether a real request would work,
// and a load balancer may hold traffic back while it says no.
export const createHealthRouter = ({ isReady = isDatabaseReady } = {}) => {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/ready", (req, res) => {
    const ready = isReady();
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "unavailable",
    });
  });

  return router;
};

export default createHealthRouter;
