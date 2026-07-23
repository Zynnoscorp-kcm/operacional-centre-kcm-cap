import { createOcrWorker } from "./app.js";
import { createOcrHttpServer } from "./http-server.js";
import { createPipelineDocumentRecognizer } from "./pipeline-recognizer.js";
import { inspectOcrRuntime } from "./runtime-metadata.js";
import { TesseractDigitsProvider } from "../../src/ocr/adapters/tesseract-provider.js";

const port = Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new TypeError("PORT no es valido");

const inspectedRuntime = inspectOcrRuntime({
  containerBuildId: process.env.KCM_OCR_WORKER_BUILD_ID
});

const worker = createOcrWorker({
  recognizeDocument: createPipelineDocumentRecognizer({
    providerFactory: () => new TesseractDigitsProvider({
      binaryPath: inspectedRuntime.commands.tesseract,
      includeBinaryArtifacts: true
    }),
    runtimeMetadata: inspectedRuntime.metadata
  }),
  secret: process.env.KCM_OCR_WORKER_SECRET
});
const server = createOcrHttpServer(worker);

server.listen(port, "0.0.0.0", () => {
  // No se registran encabezados, cuerpos, hashes, IDs ni resultados OCR.
  process.stdout.write(`OCR worker listo en puerto ${port}\n`);
});
