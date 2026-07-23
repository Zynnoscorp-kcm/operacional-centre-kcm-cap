import { PNG } from "pngjs";

function copyImage(source, destination, destinationX, destinationY) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const destinationStart = (((destinationY + y) * destination.width) + destinationX) * 4;
    source.data.copy(destination.data, destinationStart, sourceStart, sourceStart + (source.width * 4));
  }
}

function drawBorder(image, x, y, width, height, color) {
  for (let offsetX = 0; offsetX < width; offsetX += 1) {
    for (const borderY of [y, y + height - 1]) {
      const offset = ((borderY * image.width) + x + offsetX) * 4;
      image.data.set(color, offset);
    }
  }
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (const borderX of [x, x + width - 1]) {
      const offset = (((y + offsetY) * image.width) + borderX) * 4;
      image.data.set(color, offset);
    }
  }
}

export function createCropContactSheet(extraction, {
  rowStart = 1,
  rowEnd = 8,
  columns = 5,
  gap = 8,
  border = 2,
  comparisonGap = 4
} = {}) {
  if (!extraction?.crops || !Array.isArray(extraction.crops)) throw new TypeError("La extraccion de recortes es obligatoria");
  if (![rowStart, rowEnd, columns, gap, border, comparisonGap].every(Number.isInteger)
    || rowStart < 1 || rowEnd < rowStart || columns < 1 || columns > 10
    || gap < 0 || gap > 64 || border < 1 || border > 16 || comparisonGap < 0 || comparisonGap > 32) {
    throw new TypeError("La configuracion de la hoja de contacto es invalida");
  }
  const selected = extraction.crops
    .filter((crop) => crop.rowIndex >= rowStart && crop.rowIndex <= rowEnd)
    .sort((left, right) => left.rowIndex - right.rowIndex || left.digitIndex - right.digitIndex);
  if (selected.length === 0) throw new RangeError("No existen recortes en el intervalo solicitado");

  if (selected.length > 200) throw new RangeError("La hoja de contacto excede 200 recortes");
  const decoded = selected.map((crop) => ({
    crop,
    processed: PNG.sync.read(crop.pngBytes),
    visual: PNG.sync.read(crop.visualPngBytes ?? crop.pngBytes)
  }));
  const cellWidth = Math.max(...decoded.map(({ processed, visual }) => processed.width + visual.width + comparisonGap)) + (border * 2);
  const cellHeight = Math.max(...decoded.map(({ processed, visual }) => Math.max(processed.height, visual.height))) + (border * 2);
  const rows = Math.ceil(decoded.length / columns);
  const width = (columns * cellWidth) + ((columns + 1) * gap);
  const height = (rows * cellHeight) + ((rows + 1) * gap);
  if ((width * height) > 50_000_000) throw new RangeError("La hoja de contacto excede el limite de pixeles");
  const contactSheet = new PNG({ width, height });
  contactSheet.data.fill(242);
  for (let offset = 3; offset < contactSheet.data.length; offset += 4) contactSheet.data[offset] = 255;

  const layout = decoded.map(({ crop, processed, visual }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = gap + (column * (cellWidth + gap));
    const cellY = gap + (row * (cellHeight + gap));
    const contentWidth = processed.width + visual.width + comparisonGap;
    const contentX = cellX + border + Math.floor((cellWidth - (border * 2) - contentWidth) / 2);
    const visualY = cellY + border + Math.floor((cellHeight - (border * 2) - visual.height) / 2);
    const processedX = contentX + visual.width + comparisonGap;
    const processedY = cellY + border + Math.floor((cellHeight - (border * 2) - processed.height) / 2);
    copyImage(visual, contactSheet, contentX, visualY);
    copyImage(processed, contactSheet, processedX, processedY);
    drawBorder(
      contactSheet,
      cellX,
      cellY,
      cellWidth,
      cellHeight,
      crop.isBlank ? [90, 120, 150, 255] : [15, 105, 75, 255]
    );
    return Object.freeze({
      cropId: crop.cropId,
      rowIndex: crop.rowIndex,
      digitIndex: crop.digitIndex,
      isBlank: crop.isBlank,
      x: cellX,
      y: cellY,
      width: cellWidth,
      height: cellHeight,
      visual: Object.freeze({ x: contentX, y: visualY, width: visual.width, height: visual.height }),
      processed: Object.freeze({ x: processedX, y: processedY, width: processed.width, height: processed.height })
    });
  });

  return Object.freeze({
    pngBytes: PNG.sync.write(contactSheet),
    width,
    height,
    rows,
    columns,
    layout: Object.freeze(layout)
  });
}
