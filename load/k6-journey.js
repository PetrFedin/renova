import { LAUNCH_THRESHOLDS } from "./lib/config.js";
import { runUserJourney } from "./lib/journey.js";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "2m", target: 25 },
    { duration: "2m", target: 25 },
    { duration: "30s", target: 0 },
  ],
  thresholds: LAUNCH_THRESHOLDS,
};

export default runUserJourney;
