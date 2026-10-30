/** A website submission, as GET /api/v1/submissions lists it (packages/contracts: schemas.Submission). */
export interface Submission {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  car_interest: string;
  source: string;
  /** the lead it was matched to (or made), when there is one */
  customer_id: number | null;
  /** that lead's name, or empty */
  lead_name: string;
  created_at: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Is this a submission? The page reads these fields and no others, so these are the ones checked;
 * model.test.ts holds this to the schema in packages/contracts (the bundle does not carry zod just for this).
 */
export function isSubmission(v: unknown): v is Submission {
  if (!isObject(v)) return false;
  return (
    Number.isInteger(v['id']) &&
    typeof v['name'] === 'string' &&
    typeof v['email'] === 'string' &&
    typeof v['phone'] === 'string' &&
    typeof v['message'] === 'string' &&
    typeof v['car_interest'] === 'string' &&
    typeof v['source'] === 'string' &&
    (v['customer_id'] === null || Number.isInteger(v['customer_id'])) &&
    typeof v['lead_name'] === 'string' &&
    typeof v['created_at'] === 'string'
  );
}

/** What GET /api/v1/submissions answers. */
export function isSubmissionList(v: unknown): v is { items: Submission[] } {
  return isObject(v) && Array.isArray(v['items']) && v['items'].every(isSubmission);
}

/** When it came, as the classic pages write it: the browser's own idea of a date and a time. */
export function whenOf(iso: string): string {
  return new Date(iso).toLocaleString();
}
