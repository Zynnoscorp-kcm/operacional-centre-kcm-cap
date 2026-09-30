import { AttendanceCaptureService } from "./attendance-service.js";
import { AuditLedger } from "./audit-ledger.js";
import { ExamReconciliationService } from "./exam-reconciliation.js";
import { SimulatedMatrixGateway } from "./matrix-gateway.js";
import { ReleaseService } from "./release-service.js";
import {
  InMemoryAttendanceRepository,
  InMemoryEmployeeRepository,
  InMemoryReleaseRepository
} from "./repositories.js";

export function createInMemoryCore({ employees = [], clock, idFactory, mutex } = {}) {
  const employeeRepository = new InMemoryEmployeeRepository(employees);
  const attendanceRepository = new InMemoryAttendanceRepository();
  const releaseRepository = new InMemoryReleaseRepository();
  const audit = new AuditLedger({ clock, idFactory });
  const matrix = new SimulatedMatrixGateway();
  const capture = new AttendanceCaptureService({
    employees: employeeRepository,
    attendances: attendanceRepository,
    audit,
    idFactory
  });
  const exams = new ExamReconciliationService({
    attendances: attendanceRepository,
    audit,
    clock,
    idFactory
  });
  const release = new ReleaseService({
    attendances: attendanceRepository,
    releases: releaseRepository,
    matrix,
    audit,
    mutex,
    clock,
    idFactory
  });
  return Object.freeze({
    capture,
    exams,
    release,
    audit,
    matrix,
    repositories: Object.freeze({
      employees: employeeRepository,
      attendances: attendanceRepository,
      releases: releaseRepository
    })
  });
}
