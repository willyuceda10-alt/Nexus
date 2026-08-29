import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  detectSapSource,
  normalizeSapRow,
  type SapCellScalar,
  type SapSourceDetection,
} from './domain/sap-source-detection-v1.js';

const MAX_SHEETS = 20;
const MAX_COLUMNS = 256;
const MAX_DATA_ROWS = 200_000;
const HEADER_SCAN_ROWS = 20;

const structuralWarnings = new Set([
  'REFERENCE_POSITION_NOT_AVAILABLE',
  'MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE',
  'ACCOUNTING_LINE_POSITION_NOT_AVAILABLE',
]);

export type SapParsedIssue = {
  sourceRowNumber: number | null;
  severity: 'WARNING' | 'ERROR';
  code: string;
  fieldKey: string | null;
  message: string;
  details: Record<string, unknown> | null;
};

export type SapParsedRecord = {
  sourceRowNumber: number;
  externalKey: string | null;
  recordHash: string;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, SapCellScalar>;
  validationStatus: 'VALID' | 'WARNING' | 'INVALID';
  processingStatus: 'READY' | 'FAILED';
  issues: SapParsedIssue[];
};

export type SapWorkbookParseResult = {
  detection: SapSourceDetection;
  sheetName: string;
  headerRowNumber: number;
  headers: string[];
  records: SapParsedRecord[];
  issues: SapParsedIssue[];
};

export class SapWorkbookParseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SapWorkbookParseError';
  }
}

function scalarFromCell(value: ExcelJS.CellValue): SapCellScalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if ('result' in value) return scalarFromCell(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value && typeof value.error === 'string') return value.error;
  }
  return String(value);
}

function headerText(value: ExcelJS.CellValue): string {
  const scalar = scalarFromCell(value);
  return scalar === null ? '' : String(scalar).trim();
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

function issueMessage(code: string): string {
  switch (code) {
    case 'REFERENCE_POSITION_NOT_AVAILABLE':
      return 'The source does not expose the reference-document line position; exact PR/PO line identity remains unresolved.';
    case 'MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE':
      return 'The source does not expose material document + fiscal year + document item; movement identity remains reconciliation-only.';
    case 'ACCOUNTING_LINE_POSITION_NOT_AVAILABLE':
      return 'The source does not expose the accounting/material document line position; accounting line identity remains reconciliation-only.';
    case 'REQUISITION_IDENTITY_MISSING':
      return 'Purchase requisition number or requisition position is missing.';
    case 'PURCHASE_ORDER_IDENTITY_MISSING':
      return 'Purchase order number or purchase order position is missing.';
    case 'MOVEMENT_CORE_FIELDS_MISSING':
      return 'Movement type or quantity is missing.';
    case 'ACTUAL_COST_CORE_FIELDS_MISSING':
      return 'WBS element or accounting document is missing.';
    case 'COMMITMENT_CORE_FIELDS_MISSING':
      return 'WBS element or reference document is missing.';
    default:
      return code;
  }
}

function nonEmpty(value: SapCellScalar): boolean {
  return value !== null && !(typeof value === 'string' && value.trim() === '');
}

function rowHeaders(row: ExcelJS.Row): string[] {
  const count = Math.min(row.cellCount, MAX_COLUMNS);
  const values: string[] = [];
  for (let index = 1; index <= count; index += 1) values.push(headerText(row.getCell(index).value));
  return values;
}

type HeaderCandidate = {
  worksheet: ExcelJS.Worksheet;
  rowNumber: number;
  headers: string[];
  detection: SapSourceDetection;
};

function candidateStrength(candidate: HeaderCandidate): number {
  return candidate.detection.confidence * 1000
    + candidate.detection.matchedRequired.length * 10
    + candidate.detection.matchedOptional.length;
}

function detectWorksheet(workbook: ExcelJS.Workbook): HeaderCandidate {
  const candidates: HeaderCandidate[] = [];
  for (const worksheet of workbook.worksheets) {
    const end = Math.min(worksheet.rowCount, HEADER_SCAN_ROWS);
    for (let rowNumber = 1; rowNumber <= end; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const headers = rowHeaders(row);
      const detection = detectSapSource(headers);
      if (detection) candidates.push({ worksheet, rowNumber, headers, detection });
    }
  }
  candidates.sort((left, right) => candidateStrength(right) - candidateStrength(left));
  const best = candidates[0];
  if (!best) {
    throw new SapWorkbookParseError(
      'SAP_SOURCE_STRUCTURE_NOT_RECOGNIZED',
      'The workbook headers do not match a supported SAP source structure.',
    );
  }
  const conflicting = candidates.find((candidate) =>
    candidate !== best
    && candidate.detection.sourceKey !== best.detection.sourceKey
    && Math.abs(candidateStrength(candidate) - candidateStrength(best)) < 15,
  );
  if (conflicting) {
    throw new SapWorkbookParseError(
      'SAP_SOURCE_STRUCTURE_AMBIGUOUS',
      `Workbook structure matches both ${best.detection.sourceKey} and ${conflicting.detection.sourceKey}.`,
    );
  }
  return best;
}

export async function parseSapWorkbookV1(content: Buffer): Promise<SapWorkbookParseResult> {
  if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new SapWorkbookParseError('SAP_XLSX_REQUIRED', 'Automatic parsing currently supports XLSX workbooks only.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(content, {
      ignoreNodes: ['dataValidations', 'drawing', 'extLst', 'hyperlinks', 'mergeCells', 'pageMargins', 'pageSetup', 'printOptions'],
    });
  } catch (error) {
    throw new SapWorkbookParseError(
      'SAP_XLSX_INVALID',
      `The uploaded file is not a readable XLSX workbook: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (workbook.worksheets.length === 0) {
    throw new SapWorkbookParseError('SAP_XLSX_EMPTY', 'The workbook has no worksheets.');
  }
  if (workbook.worksheets.length > MAX_SHEETS) {
    throw new SapWorkbookParseError('SAP_XLSX_TOO_MANY_SHEETS', `Workbook exceeds the ${MAX_SHEETS}-sheet parser limit.`);
  }

  const selected = detectWorksheet(workbook);
  if (selected.worksheet.columnCount > MAX_COLUMNS) {
    throw new SapWorkbookParseError('SAP_XLSX_TOO_MANY_COLUMNS', `Workbook exceeds the ${MAX_COLUMNS}-column parser limit.`);
  }

  const records: SapParsedRecord[] = [];
  const issues: SapParsedIssue[] = [];
  const emittedStructuralWarnings = new Set<string>();
  const columnCount = Math.min(selected.headers.length, MAX_COLUMNS);

  for (let rowNumber = selected.rowNumber + 1; rowNumber <= selected.worksheet.rowCount; rowNumber += 1) {
    if (records.length >= MAX_DATA_ROWS) {
      throw new SapWorkbookParseError('SAP_XLSX_TOO_MANY_ROWS', `Workbook exceeds the ${MAX_DATA_ROWS}-row parser limit.`);
    }
    const row = selected.worksheet.getRow(rowNumber);
    const cells: Array<{ columnIndex: number; header: string; value: SapCellScalar }> = [];
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const header = selected.headers[columnIndex - 1] ?? '';
      if (!header.trim()) continue;
      cells.push({ columnIndex, header, value: scalarFromCell(row.getCell(columnIndex).value) });
    }
    if (!cells.some((cell) => nonEmpty(cell.value))) continue;

    const normalized = normalizeSapRow(
      selected.detection.profileId,
      cells.map(({ header, value }) => ({ header, value })),
    );
    const rowIssues: SapParsedIssue[] = [];
    for (const code of normalized.errors) {
      rowIssues.push({
        sourceRowNumber: rowNumber,
        severity: 'ERROR',
        code,
        fieldKey: null,
        message: issueMessage(code),
        details: null,
      });
    }
    for (const code of normalized.warnings) {
      if (structuralWarnings.has(code)) {
        if (!emittedStructuralWarnings.has(code)) {
          emittedStructuralWarnings.add(code);
          issues.push({
            sourceRowNumber: null,
            severity: 'WARNING',
            code,
            fieldKey: null,
            message: issueMessage(code),
            details: { profileId: selected.detection.profileId },
          });
        }
        continue;
      }
      rowIssues.push({
        sourceRowNumber: rowNumber,
        severity: 'WARNING',
        code,
        fieldKey: null,
        message: issueMessage(code),
        details: null,
      });
    }

    const rawPayload = {
      sheetName: selected.worksheet.name,
      rowNumber,
      cells,
    };
    const recordHash = createHash('sha256')
      .update(stable({ profileId: selected.detection.profileId, rawPayload }))
      .digest('hex');
    const hasErrors = rowIssues.some((issue) => issue.severity === 'ERROR');
    const hasWarnings = rowIssues.some((issue) => issue.severity === 'WARNING');
    const record: SapParsedRecord = {
      sourceRowNumber: rowNumber,
      externalKey: normalized.externalKey,
      recordHash,
      rawPayload,
      normalizedPayload: normalized.fields,
      validationStatus: hasErrors ? 'INVALID' : hasWarnings ? 'WARNING' : 'VALID',
      processingStatus: hasErrors ? 'FAILED' : 'READY',
      issues: rowIssues,
    };
    records.push(record);
    issues.push(...rowIssues);
  }

  if (records.length === 0) {
    throw new SapWorkbookParseError('SAP_XLSX_NO_DATA_ROWS', 'The detected SAP worksheet contains no data rows.');
  }

  return {
    detection: selected.detection,
    sheetName: selected.worksheet.name,
    headerRowNumber: selected.rowNumber,
    headers: selected.headers,
    records,
    issues,
  };
}
