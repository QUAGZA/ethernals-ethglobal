import fs from "node:fs";
import path from "node:path";
import type { CalibrationJob, HiddenTestsBundle, ValidationReceipt, VerificationResult, VerifyJob, VerifierEvent, Hex } from "@ethernals/shared";

export interface StoredReceipt {
  receipt: ValidationReceipt;
  receiptHash: Hex;
}

const safeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** File-backed storage under VERIFIER_DATA_DIR: tests/, jobs/, results/, receipts/, calibrations/. */
export class Store {
  constructor(private readonly dir: string) {
    for (const d of ["tests", "jobs", "results", "receipts", "events", "calibrations"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  private file(kind: string, id: string, ext = "json") {
    if (!safeId(id)) throw new Error("bad id");
    return path.join(this.dir, kind, `${id}.${ext}`);
  }
  private read<T>(kind: string, id: string): T | null {
    if (!safeId(id)) return null;
    const f = this.file(kind, id);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;
  }
  private write(kind: string, id: string, value: unknown) {
    fs.writeFileSync(this.file(kind, id), JSON.stringify(value, null, 2));
  }

  putTests(testsId: string, bundle: HiddenTestsBundle) { this.write("tests", testsId, bundle); }
  getTests(testsId: string) { return this.read<HiddenTestsBundle>("tests", testsId); }

  putJob(job: VerifyJob) { this.write("jobs", job.jobId, job); }
  getJob(jobId: string) { return this.read<VerifyJob>("jobs", jobId); }

  putResult(jobId: string, r: VerificationResult) { this.write("results", jobId, r); }
  getResult(jobId: string) { return this.read<VerificationResult>("results", jobId); }

  putReceipt(jobId: string, r: StoredReceipt) { this.write("receipts", jobId, r); }
  getReceipt(jobId: string) { return this.read<StoredReceipt>("receipts", jobId); }

  putCalibration(c: CalibrationJob) { this.write("calibrations", c.calibrationId, c); }
  getCalibration(id: string) { return this.read<CalibrationJob>("calibrations", id); }

  appendEvent(jobId: string, e: VerifierEvent) {
    if (safeId(jobId)) fs.appendFileSync(this.file("events", jobId, "ndjson"), JSON.stringify(e) + "\n");
  }
  readEvents(jobId: string): VerifierEvent[] {
    if (!safeId(jobId)) return [];
    const f = this.file("events", jobId, "ndjson");
    return fs.existsSync(f)
      ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as VerifierEvent)
      : [];
  }
}
