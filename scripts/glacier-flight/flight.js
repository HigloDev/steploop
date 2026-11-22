const FLIGHT_DURATION = 2.24;

function sampleFlight(seconds) {
  const t = Math.min(FLIGHT_DURATION, Math.max(0, seconds));
  const ease = (start, end) => {
    const position = Math.min(1, Math.max(0, (t - start) / (end - start)));
    return position ** 3 * (10 + position * (-15 + 6 * position));
  };
  return {
    yaw: -43 * (1 - ease(0, FLIGHT_DURATION)),
    pitch: 24 * (1 - ease(0.28, FLIGHT_DURATION)),
    perspective: 0.82 * (1 - ease(1.06, FLIGHT_DURATION)),
    build: ease(0.09, 1.6),
    landing: ease(1.51, FLIGHT_DURATION),
    glint: ease(1.57, 1.74) * (1 - ease(1.74, 1.98)),
  };
}
