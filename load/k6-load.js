import { LAUNCH_THRESHOLDS } from "./lib/config.js";
import { runUserJourney } from "./lib/journey.js";

export const options = {
  stages: [
    { duration: "1m", target: 25 },
    { duration: "2m", target: 50 },
    { duration: "5m", target: 50 },
    { duration: "1m", target: 0 },
  ],
  thresholds: LAUNCH_THRESHOLDS,
};

export default runUserJourney;
