export interface ExtractedTableData {
  title: string;
  columns: string[];
  rows: string[][]; // Array of row arrays, where each item aligns with columns
  summary?: string;
}

export interface UploadedFile {
  name: string;
  size: number;
  type: string;
  base64: string;
}
