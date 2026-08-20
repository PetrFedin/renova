import { LAUNCH_THRESHOLDS } from "./lib/config.js";
import { runUserJourney } from "./lib/journey.js";

export const options = {
  vus: 2,
  duration: "20s",
  thresholds: LAUNCH_THRESHOLDS,
};

export default runUserJourney;
