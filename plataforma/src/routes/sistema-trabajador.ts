/**
 * Rutas web y API para la Función 8: Sistema General por Trabajador.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/environment.ts";
import { tryParseWorkerNumber } from "../domain/comun/numero-trabajador.ts";
import { WorkerSystemService } from "../domain/sistema-trabajador/servicio.ts";
import type { WorkerSystemRepositoryPort } from "../ports/sistema-trabajador.port.ts";
import { renderWorkerListPage } from "../web/pages/sistema-trabajador/directorio.ts";
import { renderWorkerProfilePage } from "../web/pages/sistema-trabajador/ficha.ts";
import { renderDepartmentSummaryPage } from "../web/pages/sistema-trabajador/resumen-departamento.ts";
import { renderCourseCoveragePage } from "../web/pages/sistema-trabajador/cobertura-cursos.ts";
import { renderDncCoveragePage } from "../web/pages/sistema-trabajador/cobertura-dnc.ts";

export function registerWorkerSystemRoutes(
  app: FastifyInstance,
  config: AppConfig,
  repository: WorkerSystemRepositoryPort,
): void {
  const service = new WorkerSystemService(repository);

  // 1. Directorio de trabajadores (HTML)
  app.get("/trabajadores", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      q?: string;
      department?: string;
      area?: string;
      payrollType?: string;
      hireDateFrom?: string;
      hireDateTo?: string;
    };

    const filter = {
      ...(query.q ? { query: query.q } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.area ? { area: query.area } : {}),
      ...(query.payrollType ? { payrollType: query.payrollType } : {}),
      ...(fechaIso(query.hireDateFrom) ? { hireDateFrom: query.hireDateFrom } : {}),
      ...(fechaIso(query.hireDateTo) ? { hireDateTo: query.hireDateTo } : {}),
      activeOnly: true,
    };

    const [workers, departments, areas] = await Promise.all([
      service.listWorkers(filter),
      repository.listDepartments(),
      repository.listAreas(query.department),
    ]);

    const htmlContent = renderWorkerListPage({
      workers,
      departments,
      areas,
      selectedDepartment: query.department,
      selectedArea: query.area,
      selectedPayrollType: query.payrollType,
      hireDateFrom: fechaIso(query.hireDateFrom) ? query.hireDateFrom : undefined,
      hireDateTo: fechaIso(query.hireDateTo) ? query.hireDateTo : undefined,
      query: query.q,
      entorno: config.environment,
    });

    return reply.type("text/html; charset=utf-8").send(htmlContent);
  });

  // 2. Resumen por departamento (HTML)
  // 1b. Tablero DNC: cobertura por trabajador con filtros y concordancia.
  //
  // Se declara antes de `/trabajadores/:workerNumber` a propósito: Fastify
  // resuelve la ruta estática primero, pero dejarlas juntas hace evidente que
  // «cobertura» no puede confundirse nunca con un número de trabajador.
  app.get("/trabajadores/cobertura", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      planta?: string;
      area?: string;
      curso?: string;
      estado?: string;
    };
    const estado =
      query.estado === "FALTANTE" || query.estado === "CUBIERTO" ? query.estado : undefined;
    const filtro = {
      ...(query.planta ? { planta: query.planta } : {}),
      ...(query.area ? { area: query.area } : {}),
      ...(query.curso ? { curso: query.curso } : {}),
      ...(estado ? { estado } : {}),
    };

    const [rows, reconciliation, plants, areas, courses] = await Promise.all([
      repository.listDncCoverage(filtro),
      repository.getDncReconciliation(),
      repository.listPlants(),
      repository.listAreas(),
      repository.listDncCourses(),
    ]);

    const htmlContent = renderDncCoveragePage({
      rows,
      reconciliation,
      plants,
      areas,
      courses,
      selected: {
        planta: query.planta,
        area: query.area,
        curso: query.curso,
        estado,
      },
      entorno: config.environment,
    });
    return reply.type("text/html; charset=utf-8").send(htmlContent);
  });

  app.get("/trabajadores/departamentos", async (_request: FastifyRequest, reply: FastifyReply) => {
    const departments = await service.getDepartmentSummary();
    const htmlContent = renderDepartmentSummaryPage({
      departments,
      entorno: config.environment,
    });
    return reply.type("text/html; charset=utf-8").send(htmlContent);
  });

  // 3. Perfil de cobertura por curso (HTML)
  app.get("/trabajadores/cursos", async (_request: FastifyRequest, reply: FastifyReply) => {
    const courses = await service.getCourseCoverageSummary();
    const htmlContent = renderCourseCoveragePage({
      courses,
      entorno: config.environment,
    });
    return reply.type("text/html; charset=utf-8").send(htmlContent);
  });

  // 4. La comparativa de planta repetía las cifras de Departamentos en tarjetas;
  // las dos vistas son ahora una. La dirección vieja lleva a la nueva.
  app.get("/trabajadores/comparativa", (_request: FastifyRequest, reply: FastifyReply) =>
    reply.redirect("/trabajadores/departamentos", 301),
  );

  // 5. Ficha individual por trabajador (HTML)
  app.get("/trabajadores/:workerNumber", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { workerNumber?: string };
    const workerNumber = tryParseWorkerNumber(params.workerNumber);

    if (!workerNumber) {
      return reply.callNotFound();
    }

    const profile = await service.getWorkerProfile(workerNumber);
    if (!profile) {
      return reply.callNotFound();
    }

    const htmlContent = renderWorkerProfilePage({
      profile,
      entorno: config.environment,
    });

    return reply.type("text/html; charset=utf-8").send(htmlContent);
  });

  // 6. Endpoint de API JSON para consulta programática
  app.get(
    "/api/v1/trabajadores/:workerNumber/dnc",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { workerNumber?: string };
      const workerNumber = tryParseWorkerNumber(params.workerNumber);

      if (!workerNumber) {
        return reply.code(400).send({
          error: {
            code: "NUMERO_TRABAJADOR_INVALIDO",
            message: "El número de trabajador debe tener exactamente 5 dígitos.",
            requestId: String(request.id),
          },
        });
      }

      const profile = await service.getWorkerProfile(workerNumber);
      if (!profile) {
        return reply.code(404).send({
          error: {
            code: "TRABAJADOR_NO_ENCONTRADO",
            message: "No existe un trabajador registrado con ese número.",
            requestId: String(request.id),
          },
        });
      }

      return reply.send({
        data: profile,
        requestId: String(request.id),
      });
    },
  );
}

function fechaIso(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
