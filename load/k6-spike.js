import { LAUNCH_THRESHOLDS } from "./lib/config.js";
import { runUserJourney } from "./lib/journey.js";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "20s", target: 100 },
    { duration: "1m", target: 100 },
    { duration: "1m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: LAUNCH_THRESHOLDS,
};

export default runUserJourney;
