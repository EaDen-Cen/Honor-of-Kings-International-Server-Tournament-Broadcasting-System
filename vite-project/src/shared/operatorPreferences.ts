export const operatorPreferenceKey = (key: string) =>
  /^hok-(dock-workspace-v1(?:-presets)?|obs-scene-(cues|order)-v1|obs-audio-v1|post-game-regions-v1|window-capture-(presets-v1|slots-v3)|player-id-region-presets-v1|ghud-calibration-v1)$/.test(
    key,
  );
