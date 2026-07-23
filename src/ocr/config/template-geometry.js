export const TEMPLATE_GEOMETRY_VERSION = "formato-ocr-v6-1";

const SOURCE_WIDTH = 1216;
const SOURCE_HEIGHT = 2002;

const ROW_BOUNDARIES_PX = Object.freeze([
  265, 306, 348, 389, 431, 473, 515, 556, 598, 640,
  681, 723, 765, 807, 848, 890, 932, 973, 1015, 1057,
  1099, 1140, 1182, 1224, 1265, 1307, 1349, 1390, 1432, 1474,
  1516, 1557, 1599, 1641, 1682, 1724, 1766, 1808, 1849, 1891,
  1933
]);

const DIGIT_BOXES_X_PX = Object.freeze([
  Object.freeze({ x: 140, width: 26 }),
  Object.freeze({ x: 167, width: 25 }),
  Object.freeze({ x: 193, width: 26 }),
  Object.freeze({ x: 220, width: 25 }),
  Object.freeze({ x: 246, width: 26 })
]);

export const TEMPLATE_GEOMETRY = Object.freeze({
  version: TEMPLATE_GEOMETRY_VERSION,
  source: Object.freeze({
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    dpi: 143,
    pageSize: "LEGAL_PORTRAIT"
  }),
  pageAspectRatio: SOURCE_WIDTH / SOURCE_HEIGHT,
  participantTable: Object.freeze({ x: 95, y: 214, width: 1095, height: 1719 }),
  participantRows: Object.freeze({
    count: 40,
    left: 95,
    right: 1190,
    boundaries: ROW_BOUNDARIES_PX
  }),
  payrollColumn: Object.freeze({ x: 131, y: 214, width: 151, height: 1719 }),
  digitBoxes: Object.freeze({
    xCoordinates: DIGIT_BOXES_X_PX,
    topInset: 5,
    height: 31,
    recognitionInset: 2
  }),
  regions: Object.freeze({
    brand: Object.freeze({ x: 116, y: 18, width: 806, height: 51 }),
    sessionCode: Object.freeze({ x: 976, y: 17, width: 216, height: 56 }),
    title: Object.freeze({ x: 509, y: 75, width: 306, height: 35 }),
    sessionMetadata: Object.freeze({ x: 95, y: 113, width: 1095, height: 35 }),
    eventType: Object.freeze({ x: 94, y: 149, width: 1096, height: 48 }),
    evaluationType: Object.freeze({ x: 95, y: 198, width: 1095, height: 15 }),
    participantHeader: Object.freeze({ x: 95, y: 214, width: 1095, height: 51 }),
    instructor: Object.freeze({ x: 95, y: 1934, width: 644, height: 29 }),
    examCounts: Object.freeze({ x: 739, y: 1934, width: 451, height: 30 }),
    footerNote: Object.freeze({ x: 96, y: 1967, width: 1094, height: 18 })
  })
});

function scaleEdge(value, scale) {
  return Math.round(value * scale);
}

function scaleRect(rect, scaleX, scaleY) {
  const left = scaleEdge(rect.x, scaleX);
  const top = scaleEdge(rect.y, scaleY);
  const right = scaleEdge(rect.x + rect.width, scaleX);
  const bottom = scaleEdge(rect.y + rect.height, scaleY);
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

function insetRect(rect, inset) {
  const horizontalInset = Math.min(inset, Math.floor((rect.width - 1) / 2));
  const verticalInset = Math.min(inset, Math.floor((rect.height - 1) / 2));
  return Object.freeze({
    x: rect.x + horizontalInset,
    y: rect.y + verticalInset,
    width: rect.width - (horizontalInset * 2),
    height: rect.height - (verticalInset * 2)
  });
}

function normalizedRect(rect, width, height) {
  const precision = (value) => Number(value.toFixed(8));
  return Object.freeze({
    x: precision(rect.x / width),
    y: precision(rect.y / height),
    width: precision(rect.width / width),
    height: precision(rect.height / height)
  });
}

export function buildTemplateMap({ width = SOURCE_WIDTH, height = SOURCE_HEIGHT } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError("Las dimensiones de la plantilla deben ser enteros positivos");
  }

  const scaleX = width / SOURCE_WIDTH;
  const scaleY = height / SOURCE_HEIGHT;
  const recognitionInset = Math.max(1, scaleEdge(TEMPLATE_GEOMETRY.digitBoxes.recognitionInset, Math.min(scaleX, scaleY)));

  const rows = ROW_BOUNDARIES_PX.slice(0, -1).map((rowTop, rowOffset) => {
    const rowBottom = ROW_BOUNDARIES_PX[rowOffset + 1];
    const scaledTop = scaleEdge(rowTop, scaleY);
    const scaledBottom = scaleEdge(rowBottom, scaleY);
    const boxTop = rowTop + TEMPLATE_GEOMETRY.digitBoxes.topInset;
    const boxBottom = Math.min(rowBottom - 1, boxTop + TEMPLATE_GEOMETRY.digitBoxes.height);

    const digitBoxes = DIGIT_BOXES_X_PX.map((box, digitIndex) => {
      const visualRect = scaleRect(
        { x: box.x, y: boxTop, width: box.width, height: boxBottom - boxTop },
        scaleX,
        scaleY
      );
      return Object.freeze({
        digitIndex,
        visualRect,
        visualRectNormalized: normalizedRect(visualRect, width, height),
        recognitionRect: insetRect(visualRect, recognitionInset),
        recognitionRectNormalized: normalizedRect(insetRect(visualRect, recognitionInset), width, height)
      });
    });

    return Object.freeze({
      rowIndex: rowOffset + 1,
      rowRect: Object.freeze({
        x: scaleEdge(TEMPLATE_GEOMETRY.participantRows.left, scaleX),
        y: scaledTop,
        width: scaleEdge(TEMPLATE_GEOMETRY.participantRows.right, scaleX) - scaleEdge(TEMPLATE_GEOMETRY.participantRows.left, scaleX),
        height: scaledBottom - scaledTop
      }),
      rowRectNormalized: normalizedRect({
        x: scaleEdge(TEMPLATE_GEOMETRY.participantRows.left, scaleX),
        y: scaledTop,
        width: scaleEdge(TEMPLATE_GEOMETRY.participantRows.right, scaleX) - scaleEdge(TEMPLATE_GEOMETRY.participantRows.left, scaleX),
        height: scaledBottom - scaledTop
      }, width, height),
      digitBoxes: Object.freeze(digitBoxes)
    });
  });

  const regions = Object.fromEntries(
    Object.entries(TEMPLATE_GEOMETRY.regions).map(([name, rect]) => [name, scaleRect(rect, scaleX, scaleY)])
  );

  return Object.freeze({
    version: TEMPLATE_GEOMETRY_VERSION,
    width,
    height,
    sourceWidth: SOURCE_WIDTH,
    sourceHeight: SOURCE_HEIGHT,
    scaleX,
    scaleY,
    aspectRatioDelta: Math.abs((width / height) - TEMPLATE_GEOMETRY.pageAspectRatio),
    regions: Object.freeze(regions),
    rows: Object.freeze(rows)
  });
}
