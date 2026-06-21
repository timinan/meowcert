export const DESIGN_W = 320;
export const DESIGN_H = 580;
export const TOP_HUD_H = 36;
export const CAT_STAGE_H = 190;
export const BOTTOM_HUD_H = 70;
export const LANE_TOP_Y = TOP_HUD_H + CAT_STAGE_H;        // = 226
export const LANE_BOTTOM_Y = DESIGN_H - BOTTOM_HUD_H;     // = 510
export const HIT_LINE_Y = LANE_BOTTOM_Y - 24;             // = 486
export const LANE_GUTTER_PX = 12;
export const LANE_GAP_PX = 4;
export const LANE_COUNT = 3;

export const LANE_COLORS = [0x6fbcff, 0xc678ff, 0xffd34d] as const;

export function laneCenterX(laneId: 0 | 1 | 2, canvasWidth: number): number {
  const inner = canvasWidth - LANE_GUTTER_PX * 2;
  const colWidth = (inner - LANE_GAP_PX * (LANE_COUNT - 1)) / LANE_COUNT;
  return LANE_GUTTER_PX + colWidth * laneId + colWidth / 2 + LANE_GAP_PX * laneId;
}
